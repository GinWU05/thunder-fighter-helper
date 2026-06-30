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
  message?: string;
  dueAtIso?: string;
  retryCount?: number;
  lastError?: string;
};

type SchedulerNextDue = {
  minuteIso?: string;
  bucketKey?: string;
  minuteIsos?: string[];
  updatedAtIso?: string;
};

type SchedulerDueBucket = {
  minuteIso?: string;
  reminderKeys?: string[];
  updatedAtIso?: string;
};

const REMINDER_PREFIX = "reminder:";
const FAILED_PREFIX = "failed:";
const SCHEDULER_NEXT_DUE_KEY = "scheduler:nextDueAt";
const SCHEDULER_DUE_PREFIX = "scheduler:due:";
const MAX_RETRY_COUNT = 3;
const MAX_BUCKETS_PER_RUN = 10;

const schedulerDueKey = (minuteIso: string) =>
  `${SCHEDULER_DUE_PREFIX}${minuteIso}`;

const uniqueSortedStrings = (items: string[]) =>
  Array.from(
    new Set(
      items.filter((item) => typeof item === "string" && item.trim()),
    ),
  ).sort();

const parseJson = <T>(raw: string | null) => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const parseReminder = (raw: string | null) => {
  const parsed = parseJson<ReminderRecord>(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  return parsed;
};

const getDueAtMs = (reminder: ReminderRecord) => {
  if (typeof reminder.dueAtIso !== "string") {
    return null;
  }

  const dueAtMs = Date.parse(reminder.dueAtIso);
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
  const body = reminder.message || "提醒时间到了";
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
    return "retry" as const;
  }
};

const getSchedulerMinuteIsos = (state: SchedulerNextDue | null) =>
  uniqueSortedStrings(Array.isArray(state?.minuteIsos) ? state.minuteIsos : []);

const readSchedulerState = async (env: Env) => {
  const state = parseJson<SchedulerNextDue>(
    await env.REMINDERS_KV.get(SCHEDULER_NEXT_DUE_KEY),
  );
  const minuteIsos = getSchedulerMinuteIsos(state);
  if (minuteIsos.length === 0) {
    return null;
  }

  return minuteIsos;
};

const writeSchedulerState = async (
  env: Env,
  minuteIsos: string[],
  updatedAtIso: string,
) => {
  const sortedMinuteIsos = uniqueSortedStrings(minuteIsos);
  if (sortedMinuteIsos.length === 0) {
    await env.REMINDERS_KV.delete(SCHEDULER_NEXT_DUE_KEY);
    return;
  }

  const minuteIso = sortedMinuteIsos[0];
  const state: SchedulerNextDue = {
    minuteIso,
    bucketKey: schedulerDueKey(minuteIso),
    minuteIsos: sortedMinuteIsos,
    updatedAtIso,
  };
  await env.REMINDERS_KV.put(SCHEDULER_NEXT_DUE_KEY, JSON.stringify(state));
};

export const processDueReminders = async (env: Env, now = Date.now()) => {
  const nowIso = new Date(now).toISOString();
  const schedulerMinuteIsos = await readSchedulerState(env);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  if (!schedulerMinuteIsos) {
    console.log("reminder cron sent=0 failed=0 skipped=0");
    return { sent, failed, skipped };
  }

  const dueMinuteIsos = schedulerMinuteIsos
    .filter((minuteIso) => {
      const minuteMs = Date.parse(minuteIso);
      return Number.isFinite(minuteMs) && minuteMs <= now;
    })
    .slice(0, MAX_BUCKETS_PER_RUN);

  if (dueMinuteIsos.length === 0) {
    console.log("reminder cron sent=0 failed=0 skipped=0");
    return { sent, failed, skipped };
  }

  let nextMinuteIsos = schedulerMinuteIsos;

  for (const minuteIso of dueMinuteIsos) {
    const bucketKey = schedulerDueKey(minuteIso);

    try {
      const bucket = parseJson<SchedulerDueBucket>(
        await env.REMINDERS_KV.get(bucketKey),
      );
      const reminderKeys = uniqueSortedStrings(
        Array.isArray(bucket?.reminderKeys) ? bucket.reminderKeys : [],
      );

      if (reminderKeys.length === 0) {
        skipped += 1;
        await env.REMINDERS_KV.delete(bucketKey);
        nextMinuteIsos = nextMinuteIsos.filter((item) => item !== minuteIso);
        continue;
      }

      const remainingReminderKeys: string[] = [];

      for (const reminderKey of reminderKeys) {
        try {
          const reminder = parseReminder(
            await env.REMINDERS_KV.get(reminderKey),
          );
          if (!reminder) {
            skipped += 1;
            continue;
          }

          const dueAtMs = getDueAtMs(reminder);
          if (dueAtMs === null) {
            skipped += 1;
            continue;
          }

          if (dueAtMs > now) {
            skipped += 1;
            remainingReminderKeys.push(reminderKey);
            continue;
          }

          if (!reminder.barkUrl) {
            skipped += 1;
            continue;
          }

          const status = await handleReminder(env, reminderKey, reminder);
          if (status === "sent") {
            sent += 1;
          } else {
            failed += 1;
            if (status === "retry") {
              remainingReminderKeys.push(reminderKey);
            }
          }
        } catch (error) {
          failed += 1;
          remainingReminderKeys.push(reminderKey);
          console.log(
            `reminder cron item failed: ${reminderKey}`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      const remainingKeys = uniqueSortedStrings(remainingReminderKeys);
      if (remainingKeys.length > 0) {
        const nextBucket: SchedulerDueBucket = {
          minuteIso,
          reminderKeys: remainingKeys,
          updatedAtIso: nowIso,
        };
        await env.REMINDERS_KV.put(bucketKey, JSON.stringify(nextBucket));
      } else {
        await env.REMINDERS_KV.delete(bucketKey);
        nextMinuteIsos = nextMinuteIsos.filter((item) => item !== minuteIso);
      }
    } catch (error) {
      failed += 1;
      console.log(
        `reminder cron bucket failed: ${bucketKey}`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  await writeSchedulerState(env, nextMinuteIsos, nowIso);

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
