import {
  buildBarkUrl,
  createOwnerToken,
  createUserId,
  errorResponse,
  hashOwnerToken,
  isValidUsername,
  jsonResponse,
  listPendingReminders,
  normalizeBarkUrl,
  normalizeChannels,
  normalizeDueAtIso,
  normalizeSubscriptionIds,
  normalizeUsername,
  normalizeWebPushSubscription,
  parseJson,
  profileKey,
  readJsonBody,
  readWebPushIndex,
  reminderKey,
  removeWebPushSubscription,
  requireProfile,
  scheduleReminder,
  sanitizeMessage,
  sanitizeTitle,
  webPushIndexKey,
  webPushKey,
  webPushSubscriptionId,
  writeWebPushIndex,
  usernameKey,
  type ReminderKv,
  type ReminderProfile,
  type ReminderRecord,
  type WebPushRecord,
} from "../../../src/lib/reminderCore";
import { sendWebPush } from "../../../src/lib/webPush";

type Env = {
  REMINDERS_KV: ReminderKv;
  REMINDER_SECRET?: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
};

type RequestBody = {
  username?: unknown;
  ownerToken?: unknown;
  dueAtIso?: unknown;
  barkUrl?: unknown;
  channels?: unknown;
  title?: unknown;
  message?: unknown;
  reminderId?: unknown;
  subscription?: unknown;
  subscriptionId?: unknown;
  webPushSubscriptionIds?: unknown;
};

const getSecret = (env: Env) => env.REMINDER_SECRET?.trim() ?? "";
const getVapidConfig = (env: Env) => {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = env.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "";

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return { publicKey, privateKey, subject };
};

const getPath = (request: Request) => {
  const url = new URL(request.url);
  return url.pathname
    .replace(/^\/api\/reminders\/?/, "")
    .split("/")
    .filter(Boolean);
};

const register = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const username = normalizeUsername(body.username);
  if (!isValidUsername(username)) {
    return errorResponse("invalid_username");
  }

  const existingUserId = await env.REMINDERS_KV.get(usernameKey(username));
  if (existingUserId) {
    return errorResponse("username_taken", 409);
  }

  const userId = createUserId();
  const ownerToken = createOwnerToken();
  const profile: ReminderProfile = {
    userId,
    username,
    ownerTokenHash: await hashOwnerToken(ownerToken, secret),
    createdAtIso: new Date().toISOString(),
  };

  await env.REMINDERS_KV.put(usernameKey(username), userId);
  await env.REMINDERS_KV.put(profileKey(userId), JSON.stringify(profile));

  return jsonResponse({ userId, username, ownerToken });
};

const unregister = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const pendingReminders = await listPendingReminders(
    env.REMINDERS_KV,
    owner.profile.userId,
  );
  const webPushSubscriptionIds = await readWebPushIndex(
    env.REMINDERS_KV,
    owner.profile.userId,
  );
  await Promise.all([
    env.REMINDERS_KV.delete(usernameKey(owner.profile.username)),
    env.REMINDERS_KV.delete(profileKey(owner.profile.userId)),
    env.REMINDERS_KV.delete(webPushIndexKey(owner.profile.userId)),
    ...webPushSubscriptionIds.map((subscriptionId) =>
      env.REMINDERS_KV.delete(webPushKey(owner.profile.userId, subscriptionId)),
    ),
    ...pendingReminders.map((reminder) =>
      env.REMINDERS_KV.delete(
        reminderKey(reminder.dueAtIso, reminder.userId, reminder.id),
      ),
    ),
  ]);

  return jsonResponse({ ok: true });
};

const subscribeWebPush = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const subscription = normalizeWebPushSubscription(body.subscription);
  if (!subscription) {
    return errorResponse("invalid_web_push_subscription");
  }

  const subscriptionId = await webPushSubscriptionId(subscription);
  const nowIso = new Date().toISOString();
  const existing = await readWebPushIndex(
    env.REMINDERS_KV,
    owner.profile.userId,
  );
  const record: WebPushRecord = {
    subscriptionId,
    userId: owner.profile.userId,
    username: owner.profile.username,
    subscription,
    endpointHash: subscriptionId,
    userAgent: request.headers.get("user-agent") ?? undefined,
    createdAtIso: nowIso,
    updatedAtIso: nowIso,
  };

  await env.REMINDERS_KV.put(
    webPushKey(owner.profile.userId, subscriptionId),
    JSON.stringify(record),
  );
  await writeWebPushIndex(env.REMINDERS_KV, owner.profile.userId, [
    ...existing,
    subscriptionId,
  ]);

  return jsonResponse({ ok: true, subscriptionId });
};

const unsubscribeWebPush = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const subscription = normalizeWebPushSubscription(body.subscription);
  const subscriptionId =
    typeof body.subscriptionId === "string"
      ? body.subscriptionId.trim()
      : subscription
        ? await webPushSubscriptionId(subscription)
        : "";
  if (!subscriptionId) {
    return errorResponse("invalid_subscription_id");
  }

  await removeWebPushSubscription(
    env.REMINDERS_KV,
    owner.profile.userId,
    subscriptionId,
  );
  return jsonResponse({ ok: true });
};

const testBark = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const barkUrl = normalizeBarkUrl(body.barkUrl);
  if (!barkUrl) {
    return errorResponse("invalid_bark_url");
  }

  const reminder: ReminderRecord = {
    id: "test",
    userId: owner.profile.userId,
    username: owner.profile.username,
    barkUrl,
    title: sanitizeTitle(body.title) || "雷霆战机提醒",
    message: "Bark 测试通知",
    dueAtIso: new Date().toISOString(),
    retryCount: 0,
    createdAtIso: new Date().toISOString(),
  };
  const response = await fetch(buildBarkUrl(reminder));

  if (!response.ok) {
    return errorResponse("bark_failed", 502);
  }

  return jsonResponse({ ok: true });
};

const testWebPush = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }
  const vapid = getVapidConfig(env);
  if (!vapid) {
    return errorResponse("missing_web_push_vapid", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const index = await readWebPushIndex(env.REMINDERS_KV, owner.profile.userId);
  const requestedSubscriptionId =
    typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : "";
  const subscriptionId = requestedSubscriptionId || index[0] || "";
  if (!subscriptionId) {
    return errorResponse("missing_web_push_subscription");
  }

  const record = await env.REMINDERS_KV.get(
    webPushKey(owner.profile.userId, subscriptionId),
  );
  const parsed = parseJson<WebPushRecord>(record);
  if (!parsed?.subscription) {
    return errorResponse("missing_web_push_subscription");
  }

  const response = await sendWebPush(
    parsed.subscription,
    {
      title: sanitizeTitle(body.title) || "雷霆战机提醒",
      body: "Web 通知测试",
      url: "/",
    },
    vapid,
  );

  if (response.status === 404 || response.status === 410) {
    await removeWebPushSubscription(
      env.REMINDERS_KV,
      owner.profile.userId,
      subscriptionId,
    );
    return errorResponse("web_push_subscription_expired", 410);
  }
  if (!response.ok) {
    return errorResponse("web_push_failed", 502);
  }

  return jsonResponse({ ok: true });
};

const createReminder = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const dueAtIso = normalizeDueAtIso(body.dueAtIso);
  if (!dueAtIso) {
    return errorResponse("invalid_due_at");
  }

  const message = sanitizeMessage(body.message) || "体力提醒";
  const title = sanitizeTitle(body.title) || "雷霆战机提醒";
  const channels = normalizeChannels(body.channels);
  if (!channels) {
    return errorResponse("invalid_channels");
  }

  const barkEnabled = channels.includes("bark");
  const webPushEnabled = channels.includes("webpush");
  const barkUrl = normalizeBarkUrl(body.barkUrl);
  if (barkEnabled && !barkUrl) {
    return errorResponse("invalid_bark_url");
  }
  const requestedSubscriptionIds = normalizeSubscriptionIds(
    body.webPushSubscriptionIds,
  );
  const availableSubscriptionIds = webPushEnabled
    ? await readWebPushIndex(env.REMINDERS_KV, owner.profile.userId)
    : [];
  const webPushSubscriptionIds = webPushEnabled
    ? requestedSubscriptionIds.length > 0
      ? requestedSubscriptionIds.filter((subscriptionId) =>
          availableSubscriptionIds.includes(subscriptionId),
        )
      : availableSubscriptionIds
    : [];
  if (webPushEnabled && webPushSubscriptionIds.length === 0) {
    return errorResponse("missing_web_push_subscription");
  }

  const reminder: ReminderRecord = {
    id: crypto.randomUUID(),
    userId: owner.profile.userId,
    username: owner.profile.username,
    ...(barkUrl ? { barkUrl } : {}),
    title,
    message,
    dueAtIso,
    retryCount: 0,
    createdAtIso: new Date().toISOString(),
    channels,
    ...(webPushSubscriptionIds.length > 0 ? { webPushSubscriptionIds } : {}),
  };
  const reminderKvKey = reminderKey(
    reminder.dueAtIso,
    reminder.userId,
    reminder.id,
  );

  await env.REMINDERS_KV.put(reminderKvKey, JSON.stringify(reminder));
  await scheduleReminder(env.REMINDERS_KV, reminderKvKey, reminder.dueAtIso);

  return jsonResponse({ reminder }, { status: 201 });
};

const listReminders = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const url = new URL(request.url);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    url.searchParams.get("username"),
    url.searchParams.get("ownerToken"),
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const reminders = await listPendingReminders(
    env.REMINDERS_KV,
    owner.profile.userId,
  );
  return jsonResponse({ reminders });
};

const cancelReminder = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }

  const body = await readJsonBody<RequestBody>(request);
  const owner = await requireProfile(
    env.REMINDERS_KV,
    body.username,
    body.ownerToken,
    secret,
  );
  if ("error" in owner) {
    return errorResponse(owner.error ?? "request_failed", owner.status ?? 400);
  }

  const reminderId =
    typeof body.reminderId === "string" ? body.reminderId.trim() : "";
  const pendingReminders = await listPendingReminders(
    env.REMINDERS_KV,
    owner.profile.userId,
  );
  const reminder = pendingReminders.find((item) => item.id === reminderId);
  if (!reminder) {
    return errorResponse("reminder_not_found", 404);
  }

  await env.REMINDERS_KV.delete(
    reminderKey(reminder.dueAtIso, reminder.userId, reminder.id),
  );
  return jsonResponse({ ok: true });
};

export const onRequest = async (context: {
  request: Request;
  env: Env;
}) => {
  const { request, env } = context;
  const path = getPath(request);
  const [resource] = path;

  if (request.method === "POST" && resource === "register") {
    return register(request, env);
  }
  if (request.method === "DELETE" && resource === "user") {
    return unregister(request, env);
  }
  if (request.method === "POST" && resource === "test-bark") {
    return testBark(request, env);
  }
  if (
    request.method === "POST" &&
    resource === "web-push" &&
    path[1] === "subscribe"
  ) {
    return subscribeWebPush(request, env);
  }
  if (
    request.method === "DELETE" &&
    resource === "web-push" &&
    path[1] === "subscribe"
  ) {
    return unsubscribeWebPush(request, env);
  }
  if (request.method === "POST" && resource === "test-web-push") {
    return testWebPush(request, env);
  }
  if (request.method === "POST" && !resource) {
    return createReminder(request, env);
  }
  if (request.method === "GET" && !resource) {
    return listReminders(request, env);
  }
  if (request.method === "DELETE" && resource === "cancel") {
    return cancelReminder(request, env);
  }

  return errorResponse("not_found", 404);
};
