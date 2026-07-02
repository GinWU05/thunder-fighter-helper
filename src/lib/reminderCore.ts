export type ReminderProfile = {
  userId: string;
  username: string;
  ownerTokenHash: string;
  createdAtIso: string;
};

export type ReminderChannel = "bark" | "webpush";

export type ReminderDelivery = {
  barkSentAtIso?: string;
  webPushSentAtIso?: string;
  webPushFailedSubscriptionIds?: string[];
};

export type ReminderRecord = {
  id: string;
  userId: string;
  username: string;
  barkUrl?: string;
  title: string;
  message: string;
  dueAtIso: string;
  retryCount: number;
  createdAtIso: string;
  channels?: ReminderChannel[];
  webPushSubscriptionIds?: string[];
  delivery?: ReminderDelivery;
  lastError?: string;
};

export type WebPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type WebPushRecord = {
  subscriptionId: string;
  userId: string;
  username: string;
  subscription: WebPushSubscription;
  endpointHash: string;
  userAgent?: string;
  createdAtIso: string;
  updatedAtIso: string;
};

export type WebPushIndex = {
  userId: string;
  subscriptionIds: string[];
  updatedAtIso: string;
};

export type SchedulerNextDue = {
  minuteIso: string;
  bucketKey: string;
  minuteIsos: string[];
  updatedAtIso: string;
};

export type SchedulerDueBucket = {
  minuteIso: string;
  reminderKeys: string[];
  updatedAtIso: string;
};

export type ReminderKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    keys: Array<{ name: string }>;
    cursor?: string;
    list_complete?: boolean;
  }>;
};

export const USERNAME_PREFIX = "username:";
export const USER_PROFILE_PREFIX = "user:";
export const REMINDER_PREFIX = "reminder:";
export const FAILED_PREFIX = "failed:";
export const SCHEDULER_NEXT_DUE_KEY = "scheduler:nextDueAt";
export const SCHEDULER_DUE_PREFIX = "scheduler:due:";
export const WEB_PUSH_PREFIX = "webpush:";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const MAX_TITLE_LENGTH = 60;
const MAX_MESSAGE_LENGTH = 120;

const textEncoder = new TextEncoder();

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const isValidUsername = (username: string) =>
  USERNAME_RE.test(username);

export const normalizeUsername = (username: unknown) =>
  typeof username === "string" ? username.trim() : "";

export const createUserId = () => crypto.randomUUID();

export const createOwnerToken = () => {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  return `${crypto.randomUUID()}.${bytesToHex(randomBytes)}`;
};

export const hashOwnerToken = async (
  ownerToken: string,
  secret: string,
) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${secret}:${ownerToken}`),
  );
  return bytesToHex(new Uint8Array(digest));
};

export const usernameKey = (username: string) =>
  `${USERNAME_PREFIX}${username}`;

export const profileKey = (userId: string) =>
  `${USER_PROFILE_PREFIX}${userId}:profile`;

export const webPushIndexKey = (userId: string) =>
  `${USER_PROFILE_PREFIX}${userId}:webpush`;

export const webPushKey = (userId: string, subscriptionId: string) =>
  `${WEB_PUSH_PREFIX}${userId}:${subscriptionId}`;

export const reminderKey = (
  dueAtIso: string,
  userId: string,
  reminderId: string,
) => `${REMINDER_PREFIX}${dueAtIso}:${userId}:${reminderId}`;

export const failedReminderKey = (reminderKvKey: string) =>
  reminderKvKey.startsWith(REMINDER_PREFIX)
    ? `${FAILED_PREFIX}${reminderKvKey.slice(REMINDER_PREFIX.length)}`
    : `${FAILED_PREFIX}${reminderKvKey}`;

export const schedulerMinuteIso = (dueAtIso: string) => {
  const dueAt = new Date(dueAtIso);
  dueAt.setUTCSeconds(0, 0);
  return dueAt.toISOString();
};

export const schedulerDueKey = (minuteIso: string) =>
  `${SCHEDULER_DUE_PREFIX}${minuteIso}`;

export const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const readJsonBody = async <T>(request: Request): Promise<T> => {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
};

const uniqueSortedStrings = (items: string[]) =>
  Array.from(
    new Set(
      items.filter((item) => typeof item === "string" && item.trim()),
    ),
  ).sort();

const getSchedulerMinuteIsos = (state: SchedulerNextDue | null) =>
  uniqueSortedStrings(Array.isArray(state?.minuteIsos) ? state.minuteIsos : []);

const writeSchedulerNextDue = async (
  kv: ReminderKv,
  minuteIsos: string[],
  updatedAtIso: string,
) => {
  const sortedMinuteIsos = uniqueSortedStrings(minuteIsos);
  if (sortedMinuteIsos.length === 0) {
    await kv.delete(SCHEDULER_NEXT_DUE_KEY);
    return;
  }

  const minuteIso = sortedMinuteIsos[0];
  const state: SchedulerNextDue = {
    minuteIso,
    bucketKey: schedulerDueKey(minuteIso),
    minuteIsos: sortedMinuteIsos,
    updatedAtIso,
  };
  await kv.put(SCHEDULER_NEXT_DUE_KEY, JSON.stringify(state));
};

export const scheduleReminder = async (
  kv: ReminderKv,
  reminderKvKey: string,
  dueAtIso: string,
) => {
  const minuteIso = schedulerMinuteIso(dueAtIso);
  const bucketKey = schedulerDueKey(minuteIso);
  const updatedAtIso = new Date().toISOString();
  const existingBucket = parseJson<SchedulerDueBucket>(await kv.get(bucketKey));
  const reminderKeys = uniqueSortedStrings([
    ...(Array.isArray(existingBucket?.reminderKeys)
      ? existingBucket.reminderKeys
      : []),
    reminderKvKey,
  ]);
  const bucket: SchedulerDueBucket = {
    minuteIso,
    reminderKeys,
    updatedAtIso,
  };

  await kv.put(bucketKey, JSON.stringify(bucket));

  const state = parseJson<SchedulerNextDue>(
    await kv.get(SCHEDULER_NEXT_DUE_KEY),
  );
  await writeSchedulerNextDue(
    kv,
    [...getSchedulerMinuteIsos(state), minuteIso],
    updatedAtIso,
  );
};

export const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

export const errorResponse = (message: string, status = 400) =>
  jsonResponse({ error: message }, { status });

export const requireProfile = async (
  kv: ReminderKv,
  usernameInput: unknown,
  ownerTokenInput: unknown,
  secret: string,
) => {
  const username = normalizeUsername(usernameInput);
  const ownerToken = typeof ownerTokenInput === "string" ? ownerTokenInput : "";

  if (!isValidUsername(username) || !ownerToken) {
    return { error: "invalid_owner", status: 401 } as const;
  }

  const userId = await kv.get(usernameKey(username));
  if (!userId) {
    return { error: "user_not_found", status: 404 } as const;
  }

  const profile = parseJson<ReminderProfile>(
    await kv.get(profileKey(userId)),
  );
  if (!profile) {
    return { error: "profile_not_found", status: 404 } as const;
  }

  const incomingHash = await hashOwnerToken(ownerToken, secret);
  if (incomingHash !== profile.ownerTokenHash) {
    return { error: "invalid_owner", status: 401 } as const;
  }

  return { profile } as const;
};

export const sanitizeMessage = (message: unknown) => {
  if (typeof message !== "string") {
    return "";
  }
  return message.trim().slice(0, MAX_MESSAGE_LENGTH);
};

export const sanitizeTitle = (title: unknown) => {
  if (typeof title !== "string") {
    return "";
  }
  return title.trim().slice(0, MAX_TITLE_LENGTH);
};

export const normalizeBarkUrl = (barkUrl: unknown) => {
  if (typeof barkUrl !== "string") {
    return null;
  }

  try {
    const url = new URL(barkUrl.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const normalizeDueAtIso = (dueAtIso: unknown, now = new Date()) => {
  if (typeof dueAtIso !== "string") {
    return null;
  }

  const dueAt = new Date(dueAtIso);
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= now.getTime()) {
    return null;
  }

  return dueAt.toISOString();
};

export const normalizeChannels = (channels: unknown) => {
  if (!Array.isArray(channels)) {
    return ["bark"] satisfies ReminderChannel[];
  }

  const normalized = uniqueSortedStrings(
    channels.filter((channel): channel is ReminderChannel =>
      channel === "bark" || channel === "webpush",
    ),
  ) as ReminderChannel[];

  return normalized.length > 0 ? normalized : null;
};

export const normalizeSubscriptionIds = (subscriptionIds: unknown) =>
  Array.isArray(subscriptionIds)
    ? uniqueSortedStrings(
        subscriptionIds.filter(
          (subscriptionId): subscriptionId is string =>
            typeof subscriptionId === "string",
        ),
      )
    : [];

export const normalizeWebPushSubscription = (subscription: unknown) => {
  if (!subscription || typeof subscription !== "object") {
    return null;
  }

  const candidate = subscription as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };

  if (
    typeof candidate.endpoint !== "string" ||
    !candidate.endpoint.startsWith("https://") ||
    !candidate.keys ||
    typeof candidate.keys.p256dh !== "string" ||
    typeof candidate.keys.auth !== "string"
  ) {
    return null;
  }

  return {
    endpoint: candidate.endpoint,
    expirationTime:
      typeof candidate.expirationTime === "number"
        ? candidate.expirationTime
        : null,
    keys: {
      p256dh: candidate.keys.p256dh,
      auth: candidate.keys.auth,
    },
  } satisfies WebPushSubscription;
};

export const webPushSubscriptionId = async (subscription: WebPushSubscription) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(subscription.endpoint),
  );
  return bytesToHex(new Uint8Array(digest)).slice(0, 32);
};

export const readWebPushIndex = async (kv: ReminderKv, userId: string) => {
  const index = parseJson<WebPushIndex>(await kv.get(webPushIndexKey(userId)));
  return uniqueSortedStrings(
    Array.isArray(index?.subscriptionIds) ? index.subscriptionIds : [],
  );
};

export const writeWebPushIndex = async (
  kv: ReminderKv,
  userId: string,
  subscriptionIds: string[],
  updatedAtIso = new Date().toISOString(),
) => {
  const normalizedSubscriptionIds = uniqueSortedStrings(subscriptionIds);
  if (normalizedSubscriptionIds.length === 0) {
    await kv.delete(webPushIndexKey(userId));
    return;
  }

  const index: WebPushIndex = {
    userId,
    subscriptionIds: normalizedSubscriptionIds,
    updatedAtIso,
  };
  await kv.put(webPushIndexKey(userId), JSON.stringify(index));
};

export const removeWebPushSubscription = async (
  kv: ReminderKv,
  userId: string,
  subscriptionId: string,
) => {
  const subscriptionIds = await readWebPushIndex(kv, userId);
  await Promise.all([
    kv.delete(webPushKey(userId, subscriptionId)),
    writeWebPushIndex(
      kv,
      userId,
      subscriptionIds.filter((item) => item !== subscriptionId),
    ),
  ]);
};

export const listAllKeys = async (
  kv: ReminderKv,
  prefix: string,
  limit = 100,
) => {
  const keys: Array<{ name: string }> = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list({ prefix, cursor, limit });
    keys.push(...result.keys);
    cursor = result.list_complete === false ? result.cursor : undefined;
  } while (cursor);

  return keys;
};

export const listPendingReminders = async (
  kv: ReminderKv,
  userId: string,
) => {
  const keys = await listAllKeys(kv, REMINDER_PREFIX);
  const reminders: ReminderRecord[] = [];

  for (const key of keys) {
    if (!key.name.includes(`:${userId}:`)) {
      continue;
    }
    const reminder = parseJson<ReminderRecord>(await kv.get(key.name));
    if (reminder && reminder.userId === userId) {
      reminders.push(reminder);
    }
  }

  reminders.sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso));
  return reminders;
};

export const buildBarkUrl = (reminder: ReminderRecord) => {
  if (!reminder.barkUrl) {
    throw new Error("missing barkUrl");
  }

  const url = new URL(reminder.barkUrl);
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = `${path}/${encodeURIComponent(reminder.title)}/${encodeURIComponent(reminder.message)}`;
  url.searchParams.set("group", "雷霆战机助手");
  return url.toString();
};
