import assert from "node:assert/strict";
import {
  failedReminderKey,
  hashOwnerToken,
  listPendingReminders,
  parseJson,
  profileKey,
  reminderKey,
  requireProfile,
  usernameKey,
} from "../src/lib/reminderCore.ts";

class MemoryKv {
  store = new Map();

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.store.delete(key);
  }

  async list(options = {}) {
    const prefix = options.prefix ?? "";
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

const kv = new MemoryKv();
const secret = "test-secret";
const ownerToken = "owner-token";
const username = "pilot_001";
const userId = "user-001";
const ownerTokenHash = await hashOwnerToken(ownerToken, secret);

await kv.put(usernameKey(username), userId);
await kv.put(
  profileKey(userId),
  JSON.stringify({
    userId,
    username,
    ownerTokenHash,
    createdAtIso: "2026-01-01T00:00:00.000Z",
  }),
);

const validOwner = await requireProfile(kv, username, ownerToken, secret);
assert.equal("profile" in validOwner, true);

const invalidOwner = await requireProfile(kv, username, "bad-token", secret);
assert.deepEqual(
  { error: invalidOwner.error, status: invalidOwner.status },
  { error: "invalid_owner", status: 401 },
);

const reminder = {
  id: "reminder-001",
  userId,
  username,
  message: "体力快满了",
  dueAtIso: "2026-01-01T00:01:00.000Z",
  retryCount: 0,
  createdAtIso: "2026-01-01T00:00:00.000Z",
};
const key = reminderKey(reminder.dueAtIso, reminder.userId, reminder.id);
await kv.put(key, JSON.stringify(reminder));

const pending = await listPendingReminders(kv, userId);
assert.equal(pending.length, 1);
assert.equal(pending[0].id, reminder.id);

let current = parseJson(await kv.get(key));
for (let attempt = 1; attempt <= 3; attempt += 1) {
  current = {
    ...current,
    retryCount: current.retryCount + 1,
    lastError: "Bark 500",
  };

  if (current.retryCount >= 3) {
    await kv.put(failedReminderKey(key), JSON.stringify(current));
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(current));
  }
}

assert.equal(await kv.get(key), null);
assert.notEqual(await kv.get(failedReminderKey(key)), null);

console.log("reminder core checks passed");
