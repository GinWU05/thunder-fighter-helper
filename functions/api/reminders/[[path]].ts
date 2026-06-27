import {
  buildBarkUrl,
  createOwnerToken,
  createUserId,
  errorResponse,
  hashOwnerToken,
  isValidUsername,
  jsonResponse,
  listPendingReminders,
  normalizeDueAtIso,
  normalizeUsername,
  profileKey,
  readJsonBody,
  reminderKey,
  requireProfile,
  sanitizeMessage,
  usernameKey,
  type ReminderKv,
  type ReminderProfile,
  type ReminderRecord,
} from "../../../src/lib/reminderCore";

type Env = {
  REMINDERS_KV: ReminderKv;
  BARK_ENDPOINT?: string;
  REMINDER_SECRET?: string;
};

type RequestBody = {
  username?: unknown;
  ownerToken?: unknown;
  dueAtIso?: unknown;
  message?: unknown;
  reminderId?: unknown;
};

const getSecret = (env: Env) => env.REMINDER_SECRET?.trim() ?? "";

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
  await Promise.all([
    env.REMINDERS_KV.delete(usernameKey(owner.profile.username)),
    env.REMINDERS_KV.delete(profileKey(owner.profile.userId)),
    ...pendingReminders.map((reminder) =>
      env.REMINDERS_KV.delete(
        reminderKey(reminder.dueAtIso, reminder.userId, reminder.id),
      ),
    ),
  ]);

  return jsonResponse({ ok: true });
};

const testBark = async (request: Request, env: Env) => {
  const secret = getSecret(env);
  if (!secret) {
    return errorResponse("missing_secret", 500);
  }
  if (!env.BARK_ENDPOINT) {
    return errorResponse("missing_bark_endpoint", 500);
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

  const reminder: ReminderRecord = {
    id: "test",
    userId: owner.profile.userId,
    username: owner.profile.username,
    message: "Bark 测试通知",
    dueAtIso: new Date().toISOString(),
    retryCount: 0,
    createdAtIso: new Date().toISOString(),
  };
  const response = await fetch(buildBarkUrl(env.BARK_ENDPOINT, reminder));

  if (!response.ok) {
    return errorResponse("bark_failed", 502);
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
  const reminder: ReminderRecord = {
    id: crypto.randomUUID(),
    userId: owner.profile.userId,
    username: owner.profile.username,
    message,
    dueAtIso,
    retryCount: 0,
    createdAtIso: new Date().toISOString(),
  };

  await env.REMINDERS_KV.put(
    reminderKey(reminder.dueAtIso, reminder.userId, reminder.id),
    JSON.stringify(reminder),
  );

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
