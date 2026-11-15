import crypto from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(crypto.pbkdf2);
const ITERATIONS = 310000;
const KEY_LENGTH = 32;

export async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = await pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  return { password: hash.toString('hex'), salt: salt.toString('hex') };
}

export async function verifyPassword(password, storedHash, saltHex) {
  if (typeof password !== 'string' || typeof storedHash !== 'string' || typeof saltHex !== 'string') return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  if (salt.length !== 16 || ![16, KEY_LENGTH].includes(expected.length)) return false;
  const actual = await pbkdf2(password, salt, ITERATIONS, expected.length, 'sha256');
  return crypto.timingSafeEqual(actual, expected);
}
