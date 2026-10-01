import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing helpers (server-only).
 *
 * Uses Node's built-in scrypt — no external dependency — storing values
 * as `salt:hash` (both hex). Format: scrypt(password, salt, 64 bytes).
 */

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, salt, KEY_LEN);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
