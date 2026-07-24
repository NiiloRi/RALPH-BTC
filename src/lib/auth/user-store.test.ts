import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ensureSeeded,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  setUserStatus,
  deleteUser,
  updatePassword,
  recordLogin,
  UsernameTakenError,
} from './user-store';
import { verifyPassword } from './password';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-store-test-'));
  process.env.AUTH_DATA_DIR = dir;
  process.env.ADMIN_USERNAME = 'Niilo';
  process.env.ADMIN_PASSWORD = 'admin123';
});

afterEach(() => {
  delete process.env.AUTH_DATA_DIR;
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('seeding', () => {
  it('seeds an active admin from env on an empty store, hash verifies', async () => {
    await ensureSeeded();
    const admin = await getUserByUsername('Niilo');
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe('admin');
    expect(admin!.status).toBe('active');
    expect(admin!.tokenVersion).toBe(0);
    expect(await verifyPassword('admin123', admin!.passwordHash)).toBe(true);
  });

  it('does not double-seed', async () => {
    await ensureSeeded();
    await ensureSeeded();
    expect((await listUsers()).length).toBe(1);
  });

  it('without env vars seeds nothing (fail closed)', async () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    await ensureSeeded();
    expect((await listUsers()).length).toBe(0);
  });

  it('is case-insensitive on lookup', async () => {
    await ensureSeeded();
    expect(await getUserByUsername('niilo')).not.toBeNull();
    expect(await getUserByUsername('NIILO')).not.toBeNull();
  });
});

describe('createUser', () => {
  it('creates a pending user', async () => {
    const u = await createUser({
      username: 'Alice',
      passwordHash: 'hash',
      registrationIp: '203.0.113.7',
      registrationUserAgent: 'test-agent',
    });
    expect(u.status).toBe('pending');
    expect(u.role).toBe('user');
    const stored = await getUserByUsername('alice');
    expect(stored!.registrationIp).toBe('203.0.113.7');
  });

  it('rejects duplicates case-insensitively', async () => {
    await createUser({ username: 'Bob', passwordHash: 'h' });
    await expect(createUser({ username: 'bob', passwordHash: 'h' })).rejects.toThrow(
      UsernameTakenError
    );
  });

  it('20 concurrent creates all persist (mutex + atomic write)', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        createUser({ username: `user${i}`, passwordHash: 'h' })
      )
    );
    const users = await listUsers();
    // 20 + seeded admin
    expect(users.length).toBe(21);
  });

  it('listUsers never exposes password hashes', async () => {
    await createUser({ username: 'Carol', passwordHash: 'supersecret' });
    for (const u of await listUsers()) {
      expect(JSON.stringify(u)).not.toContain('supersecret');
      expect('passwordHash' in u).toBe(false);
    }
  });
});

describe('status transitions & tokenVersion', () => {
  it('activate sets activatedAt once', async () => {
    const u = await createUser({ username: 'Dave', passwordHash: 'h' });
    await setUserStatus(u.id, 'active');
    const after = await getUserById(u.id);
    expect(after!.status).toBe('active');
    expect(after!.activatedAt).toBeDefined();
    const stamp = after!.activatedAt;
    await setUserStatus(u.id, 'disabled');
    await setUserStatus(u.id, 'active');
    expect((await getUserById(u.id))!.activatedAt).toBe(stamp);
  });

  it('disable bumps tokenVersion (kills sessions)', async () => {
    const u = await createUser({ username: 'Eve', passwordHash: 'h' });
    await setUserStatus(u.id, 'active');
    const before = (await getUserById(u.id))!.tokenVersion;
    await setUserStatus(u.id, 'disabled');
    expect((await getUserById(u.id))!.tokenVersion).toBe(before + 1);
  });

  it('updatePassword bumps tokenVersion and stores the new hash', async () => {
    const u = await createUser({ username: 'Frank', passwordHash: 'old' });
    const v = await updatePassword(u.id, 'new');
    const after = await getUserById(u.id);
    expect(after!.passwordHash).toBe('new');
    expect(after!.tokenVersion).toBe(v);
    expect(v).toBe(1);
  });

  it('recordLogin stamps lastLoginAt', async () => {
    await ensureSeeded();
    const admin = await getUserByUsername('Niilo');
    await recordLogin(admin!.id);
    expect((await getUserById(admin!.id))!.lastLoginAt).toBeDefined();
  });
});

describe('last-active-admin protection', () => {
  it('cannot disable or delete the only active admin', async () => {
    await ensureSeeded();
    const admin = await getUserByUsername('Niilo');
    await expect(setUserStatus(admin!.id, 'disabled')).rejects.toThrow(/last active admin/);
    await expect(deleteUser(admin!.id)).rejects.toThrow(/last active admin/);
  });

  it('non-admins can be deleted freely', async () => {
    const u = await createUser({ username: 'Mallory', passwordHash: 'h' });
    await deleteUser(u.id);
    expect(await getUserById(u.id)).toBeNull();
  });
});

describe('store integrity', () => {
  it('external file change is picked up (mtime invalidation)', async () => {
    await ensureSeeded();
    const file = path.join(dir, 'users.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    parsed.users[0].username = 'Renamed';
    parsed.users[0].usernameLower = 'renamed';
    // ensure a different mtime even on coarse-grained filesystems
    fs.writeFileSync(file, JSON.stringify(parsed));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);
    expect(await getUserByUsername('renamed')).not.toBeNull();
  });

  it('corrupt JSON throws a clear error instead of silently reseeding', async () => {
    await ensureSeeded();
    const file = path.join(dir, 'users.json');
    fs.writeFileSync(file, '{not json');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);
    await expect(getUserByUsername('Niilo')).rejects.toThrow(/Corrupt auth store/);
  });
});
