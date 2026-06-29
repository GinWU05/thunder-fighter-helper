type ReminderKv = KVNamespace;

type Env = {
  REMINDERS_KV: ReminderKv;
};

type ReminderRecord = {
  id?: string;
  userId?: string;
  username?: string;
  barkUrl?: string;
  title?: string;
  body?: string;
  message?: string;
  dueAt?: string;
  dueAtIso?: string;
  status?: string;
  retryCount?: number;
  lastError?: string;
};

const REMINDER_PREFIX = "reminder:";
const FAILED_PREFIX = "failed:";
const MAX_RETRY_COUNT = 3;
const LIST_LIMIT = 100;

const parseReminder = (raw: string | null) => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ReminderRecord;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const getDueAtMs = (reminder: ReminderRecord) => {
  const dueAt = reminder.dueAtIso ?? reminder.dueAt;
  if (typeof dueAt !== "string") {
    return null;
  }

  const dueAtMs = Date.parse(dueAt);
  return Number.isFinite(dueAtMs) ? dueAtMs : null;
};

const getRetryCount = (reminder: ReminderRecord) => {
  if (
    typeof reminder.retryCount === "number" &&
    Number.isFinite(reminder.retryCount)
  ) {
    return Math.max(0, Math.floor(reminder.retryCount));
  }
  return 0;
};

const buildFailedKey = (key: string) =>
  key.startsWith(REMINDER_PREFIX)
    ? `${FAILED_PREFIX}${key.slice(REMINDER_PREFIX.length)}`
    : `${FAILED_PREFIX}${key}`;

const buildBarkUrl = (reminder: ReminderRecord) => {
  if (!reminder.barkUrl) {
    return null;
  }

  const title = reminder.title || "雷霆战机提醒";
  const body = reminder.body || reminder.message || "提醒时间到了";
  const url = new URL(reminder.barkUrl);
  const path = url.pathname.replace(/\/$/, "");

  url.pathname = `${path}/${encodeURIComponent(title)}/${encodeURIComponent(
    body,
  )}`;
  url.searchParams.set("group", "雷霆战机助手");
  return url.toString();
};

const sendBark = async (reminder: ReminderRecord) => {
  const barkUrl = buildBarkUrl(reminder);
  if (!barkUrl) {
    throw new Error("missing barkUrl");
  }

  const response = await fetch(barkUrl, {
    method: "GET",
  });

  if (!response.ok) {
    throw new Error(`Bark ${response.status}`);
  }
};

const handleReminder = async (
  env: Env,
  key: string,
  reminder: ReminderRecord,
) => {
  try {
    await sendBark(reminder);
    await env.REMINDERS_KV.delete(key);
    return "sent" as const;
  } catch (error) {
    const retryCount = getRetryCount(reminder) + 1;
    const updated: ReminderRecord = {
      ...reminder,
      retryCount,
      lastError: error instanceof Error ? error.message : "unknown_error",
    };

    if (retryCount >= MAX_RETRY_COUNT) {
      await env.REMINDERS_KV.put(buildFailedKey(key), JSON.stringify(updated));
      await env.REMINDERS_KV.delete(key);
      return "failed" as const;
    }

    await env.REMINDERS_KV.put(key, JSON.stringify(updated));
    return "failed" as const;
  }
};

export const processDueReminders = async (env: Env, now = Date.now()) => {
  const result = await env.REMINDERS_KV.list({
    prefix: REMINDER_PREFIX,
    limit: LIST_LIMIT,
  });
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const key of result.keys) {
    try {
      const reminder = parseReminder(await env.REMINDERS_KV.get(key.name));
      if (!reminder) {
        skipped += 1;
        continue;
      }

      if (reminder.status && reminder.status !== "pending") {
        skipped += 1;
        continue;
      }

      const dueAtMs = getDueAtMs(reminder);
      if (dueAtMs === null || dueAtMs > now) {
        skipped += 1;
        continue;
      }

      if (!reminder.barkUrl) {
        skipped += 1;
        continue;
      }

      const status = await handleReminder(env, key.name, reminder);
      if (status === "sent") {
        sent += 1;
      } else {
        failed += 1;
      }
    } catch (error) {
      failed += 1;
      console.log(
        `reminder cron item failed: ${key.name}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`reminder cron sent=${sent} failed=${failed} skipped=${skipped}`);
  return { sent, failed, skipped };
};

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(processDueReminders(env));
  },
};
