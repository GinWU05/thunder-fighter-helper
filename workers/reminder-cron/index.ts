import {
  buildBarkUrl,
  failedReminderKey,
  listAllKeys,
  parseJson,
  REMINDER_PREFIX,
  type ReminderKv,
  type ReminderRecord,
} from "../../src/lib/reminderCore";

type Env = {
  REMINDERS_KV: ReminderKv;
  BARK_ENDPOINT?: string;
};

const MAX_RETRY_COUNT = 3;

const notifyBark = async (endpoint: string, reminder: ReminderRecord) => {
  const response = await fetch(buildBarkUrl(endpoint, reminder));
  if (!response.ok) {
    throw new Error(`Bark ${response.status}`);
  }
};

export const processDueReminders = async (
  env: Env,
  now = new Date(),
) => {
  if (!env.BARK_ENDPOINT) {
    throw new Error("missing BARK_ENDPOINT");
  }

  const keys = await listAllKeys(env.REMINDERS_KV, REMINDER_PREFIX);
  const nowIso = now.toISOString();
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const key of keys) {
    const reminder = parseJson<ReminderRecord>(
      await env.REMINDERS_KV.get(key.name),
    );
    if (!reminder || reminder.dueAtIso > nowIso) {
      continue;
    }

    try {
      await notifyBark(env.BARK_ENDPOINT, reminder);
      await env.REMINDERS_KV.delete(key.name);
      sent += 1;
    } catch (error) {
      const retryCount = reminder.retryCount + 1;
      const updated: ReminderRecord = {
        ...reminder,
        retryCount,
        lastError: error instanceof Error ? error.message : "unknown_error",
      };

      if (retryCount >= MAX_RETRY_COUNT) {
        await env.REMINDERS_KV.put(
          failedReminderKey(key.name),
          JSON.stringify(updated),
        );
        await env.REMINDERS_KV.delete(key.name);
        failed += 1;
      } else {
        await env.REMINDERS_KV.put(key.name, JSON.stringify(updated));
        retried += 1;
      }
    }
  }

  return { sent, retried, failed };
};

const worker = {
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(processDueReminders(env));
  },
};

export default worker;
