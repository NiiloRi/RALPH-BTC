/**
 * JSON-file user store.
 *
 * Storage: AUTH_DATA_DIR (tests) or <cwd>/data/auth/users.json. In Docker cwd
 * is /app, so the file lands in the existing persistent `macro-cache:/app/data`
 * volume (uid 1001-writable) and survives container rebuilds — same pattern as
 * the FRED cache in src/lib/data/price-fetcher.ts.
 *
 * Concurrency: the app is a single node process. All mutations run through an
 * in-process promise-queue mutex and write atomically (tmp file + rename).
 * Reads go through an in-memory cache invalidated by file mtime, which makes
 * the cache safe to duplicate across the separately-bundled proxy and app
 * bundles — both converge on the same users.json.
 *
 * Seeding: an empty store lazily seeds one active admin from ADMIN_USERNAME /
 * ADMIN_PASSWORD env vars (hashed at seed time). No env vars → no seed →
 * nobody can log in (fail closed). A corrupt users.json throws — it is never
 * silently replaced, since that would drop every account.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword } from './password';
import type { PublicUser, UserRecord, UserStatus } from './types';
import { toPublicUser } from './types';

function dataDir(): string {
  return process.env.AUTH_DATA_DIR ?? path.join(process.cwd(), 'data', 'auth');
}
function storePath(): string {
  return path.join(dataDir(), 'users.json');
}

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username already taken: ${username}`);
    this.name = 'UsernameTakenError';
  }
}

interface StoreFile {
  users: UserRecord[];
}

// ---- cached read path --------------------------------------------------------
let cache: { users: UserRecord[]; mtimeMs: number; file: string } | null = null;

function readStore(): StoreFile {
  const file = storePath();
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cache = null;
    return { users: [] };
  }
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs) {
    return { users: cache.users };
  }
  const raw = fs.readFileSync(file, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Never silently reseed over a corrupt store — that would delete accounts.
    throw new Error(`Corrupt auth store at ${file}: ${(e as Error).message}`);
  }
  const users = (parsed as StoreFile).users;
  if (!Array.isArray(users)) {
    throw new Error(`Corrupt auth store at ${file}: missing users[]`);
  }
  cache = { users, mtimeMs: stat.mtimeMs, file };
  return { users };
}

function writeStore(users: UserRecord[]): void {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = storePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2));
  fs.renameSync(tmp, file); // atomic on the same filesystem
  const stat = fs.statSync(file);
  cache = { users, mtimeMs: stat.mtimeMs, file };
}

// ---- mutation mutex ----------------------------------------------------------
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined); // keep the chain alive after failures
  return run;
}

// ---- seeding -----------------------------------------------------------------
export async function ensureSeeded(): Promise<void> {
  // Fast path outside the lock; the authoritative check re-runs inside it.
  if (readStore().users.length > 0) return;
  await withLock(async () => {
    if (readStore().users.length > 0) return;
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password) {
      console.warn(
        '[auth] user store is empty and ADMIN_USERNAME/ADMIN_PASSWORD are unset — nobody can log in'
      );
      return;
    }
    const now = new Date().toISOString();
    const admin: UserRecord = {
      id: uuidv4(),
      username,
      usernameLower: username.toLowerCase(),
      passwordHash: await hashPassword(password),
      role: 'admin',
      status: 'active',
      tokenVersion: 0,
      createdAt: now,
      activatedAt: now,
    };
    writeStore([admin]);
    console.log(`[auth] seeded admin user "${username}"`);
  });
}

// ---- reads --------------------------------------------------------------------
export async function getUserByUsername(username: string): Promise<UserRecord | null> {
  await ensureSeeded();
  const lower = username.toLowerCase();
  return readStore().users.find(u => u.usernameLower === lower) ?? null;
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  await ensureSeeded();
  return readStore().users.find(u => u.id === id) ?? null;
}

export async function listUsers(): Promise<PublicUser[]> {
  await ensureSeeded();
  return readStore().users.map(toPublicUser);
}

// ---- mutations -----------------------------------------------------------------
export async function createUser(input: {
  username: string;
  passwordHash: string;
  registrationIp?: string;
  registrationUserAgent?: string;
}): Promise<PublicUser> {
  await ensureSeeded();
  return withLock(() => {
    const { users } = readStore();
    const lower = input.username.toLowerCase();
    if (users.some(u => u.usernameLower === lower)) {
      throw new UsernameTakenError(input.username);
    }
    const user: UserRecord = {
      id: uuidv4(),
      username: input.username,
      usernameLower: lower,
      passwordHash: input.passwordHash,
      role: 'user',
      status: 'pending',
      tokenVersion: 0,
      createdAt: new Date().toISOString(),
      registrationIp: input.registrationIp,
      registrationUserAgent: input.registrationUserAgent,
    };
    writeStore([...users, user]);
    return toPublicUser(user);
  });
}

function isLastActiveAdmin(users: UserRecord[], id: string): boolean {
  const target = users.find(u => u.id === id);
  if (!target || target.role !== 'admin' || target.status !== 'active') return false;
  return users.filter(u => u.role === 'admin' && u.status === 'active').length <= 1;
}

export async function setUserStatus(id: string, status: UserStatus): Promise<void> {
  await withLock(() => {
    const { users } = readStore();
    const user = users.find(u => u.id === id);
    if (!user) throw new Error(`No such user: ${id}`);
    if (status !== 'active' && isLastActiveAdmin(users, id)) {
      throw new Error('Cannot disable the last active admin');
    }
    user.status = status;
    if (status === 'active' && !user.activatedAt) {
      user.activatedAt = new Date().toISOString();
    }
    if (status === 'disabled') {
      user.tokenVersion += 1; // kill existing sessions immediately
    }
    writeStore(users);
  });
}

export async function deleteUser(id: string): Promise<void> {
  await withLock(() => {
    const { users } = readStore();
    if (!users.some(u => u.id === id)) throw new Error(`No such user: ${id}`);
    if (isLastActiveAdmin(users, id)) {
      throw new Error('Cannot delete the last active admin');
    }
    writeStore(users.filter(u => u.id !== id));
  });
}

/** New password → new hash; bumps tokenVersion so other sessions die. */
export async function updatePassword(id: string, newHash: string): Promise<number> {
  return withLock(() => {
    const { users } = readStore();
    const user = users.find(u => u.id === id);
    if (!user) throw new Error(`No such user: ${id}`);
    user.passwordHash = newHash;
    user.tokenVersion += 1;
    writeStore(users);
    return user.tokenVersion;
  });
}

export async function recordLogin(id: string): Promise<void> {
  await withLock(() => {
    const { users } = readStore();
    const user = users.find(u => u.id === id);
    if (!user) return;
    user.lastLoginAt = new Date().toISOString();
    writeStore(users);
  });
}
