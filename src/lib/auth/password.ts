/**
 * Password hashing (bcryptjs — pure JS, safe in the alpine standalone image).
 * Cost 11 ≈ 150–300 ms per hash on the server; login rate limiting bounds abuse.
 */

import bcrypt from 'bcryptjs';

const COST = 11;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Real pre-computed bcrypt hash of a random throwaway string; compared against
 * when the username does not exist so unknown-user and wrong-password take the
 * same time (no user enumeration via timing). Never matches anything.
 */
export const DUMMY_HASH = '$2b$11$gwS.g2ZP59pUva7SgUQwxuyIKfKL0Ho2yK21ub6p9xq1LXdj2QGta';
