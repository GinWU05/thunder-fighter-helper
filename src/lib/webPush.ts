import type { WebPushSubscription } from "./reminderCore";

type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
};

type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

const textEncoder = new TextEncoder();

const base64UrlToBytes = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const concatBytes = (...parts: Uint8Array[]) => {
  const totalLength = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }

  return output;
};

const hmacSha256 = async (keyBytes: Uint8Array, data: Uint8Array) => {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(signature);
};

const hkdfExpand = async (
  prk: Uint8Array,
  info: Uint8Array,
  length: number,
) => {
  const block = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return block.slice(0, length);
};

const createVapidJwt = async (
  endpoint: string,
  vapid: VapidConfig,
  expiresAtSeconds = Math.floor(Date.now() / 1000) + 12 * 60 * 60,
) => {
  const publicKeyBytes = base64UrlToBytes(vapid.publicKey);
  const privateKeyBytes = base64UrlToBytes(vapid.privateKey);
  if (publicKeyBytes.length !== 65 || privateKeyBytes.length !== 32) {
    throw new Error("invalid_vapid_key");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: bytesToBase64Url(publicKeyBytes.slice(1, 33)),
      y: bytesToBase64Url(publicKeyBytes.slice(33, 65)),
      d: bytesToBase64Url(privateKeyBytes),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const audience = new URL(endpoint).origin;
  const header = bytesToBase64Url(
    textEncoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const payload = bytesToBase64Url(
    textEncoder.encode(
      JSON.stringify({
        aud: audience,
        exp: expiresAtSeconds,
        sub: vapid.subject,
      }),
    ),
  );
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    textEncoder.encode(input),
  );

  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`;
};

const encryptPayload = async (
  payload: Uint8Array,
  subscription: WebPushSubscription,
) => {
  const receiverPublicKey = base64UrlToBytes(subscription.keys.p256dh);
  const authSecret = base64UrlToBytes(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // workers-types types generateKey as CryptoKey | CryptoKeyPair; ECDH always returns a pair.
  const senderKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const senderPublicKeyRaw = await crypto.subtle.exportKey(
    "raw",
    senderKeys.publicKey,
  );
  const senderPublicKey = new Uint8Array(senderPublicKeyRaw as ArrayBuffer);
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  // Narrow CF workers-types + Next DOM libs disagree on ECDH deriveBits params.
  // Runtime shape is standard WebCrypto ECDH.
  const sharedSecretRaw = await crypto.subtle.deriveBits(
    { name: "ECDH", public: receiverKey } as never,
    senderKeys.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedSecretRaw);
  const authPrk = await hmacSha256(authSecret, sharedSecret);
  const ikm = await hkdfExpand(
    authPrk,
    concatBytes(
      textEncoder.encode("WebPush: info\0"),
      receiverPublicKey,
      senderPublicKey,
    ),
    32,
  );
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(
    prk,
    textEncoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdfExpand(
    prk,
    textEncoder.encode("Content-Encoding: nonce\0"),
    12,
  );
  const content = concatBytes(payload, new Uint8Array([2]));
  const key = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, content),
  );
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  const header = concatBytes(
    salt,
    recordSize,
    new Uint8Array([senderPublicKey.length]),
    senderPublicKey,
  );

  return concatBytes(header, encrypted);
};

export const sendWebPush = async (
  subscription: WebPushSubscription,
  payload: WebPushPayload,
  vapid: VapidConfig,
) => {
  const body = await encryptPayload(
    textEncoder.encode(JSON.stringify(payload)),
    subscription,
  );
  const jwt = await createVapidJwt(subscription.endpoint, vapid);

  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "2419200",
      urgency: "normal",
    },
    body,
  });
};
