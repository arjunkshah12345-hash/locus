export type PublicUser = {
  id: string;
  email: string;
  name: string;
};

export type StoredUser = PublicUser & {
  salt: string;
  hash: string;
  createdAt: number;
};

const iterations = 80_000;

function bytesToB64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function b64ToBytes(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string, salt?: Uint8Array): Promise<{ salt: string; hash: string }> {
  const saltBytes = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return { salt: bytesToB64(saltBytes), hash: bytesToB64(new Uint8Array(bits)) };
}

export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  const next = await hashPassword(password, b64ToBytes(salt));
  if (next.hash.length !== hash.length) return false;
  let diff = 0;
  for (let index = 0; index < hash.length; index += 1) diff |= next.hash.charCodeAt(index) ^ hash.charCodeAt(index);
  return diff === 0;
}

export function publicUser(user: StoredUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

export function sessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToB64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function readSession(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)locus_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [`locus_session=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=2592000"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const parts = ["locus_session=", "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
