import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_HASH } from './password';
import { registerSchema, usernameSchema, passwordSchema } from './types';

describe('password hashing', () => {
  it('hash → verify roundtrip', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('wrong password fails', async () => {
    const hash = await hashPassword('right');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('hashes are salted (two hashes of the same input differ)', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('DUMMY_HASH is a valid bcrypt hash that matches nothing common', async () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$11\$/);
    expect(await verifyPassword('admin123', DUMMY_HASH)).toBe(false);
    expect(await verifyPassword('', DUMMY_HASH)).toBe(false);
  });

  it('documents the 72-byte bcrypt boundary (why zod caps at 72)', async () => {
    const seventyTwo = 'a'.repeat(72);
    const seventyThree = 'a'.repeat(73);
    const hash = await hashPassword(seventyTwo);
    // bcrypt truncates beyond 72 bytes → these collide; the zod max prevents it
    expect(await verifyPassword(seventyThree, hash)).toBe(true);
    expect(passwordSchema.safeParse(seventyThree).success).toBe(false);
    expect(passwordSchema.safeParse(seventyTwo).success).toBe(true);
  });
});

describe('registration validation', () => {
  const valid = {
    username: 'alice',
    password: 'password123',
    confirm: 'password123',
    website: '',
    ft: 'token',
  };

  it('accepts a valid registration', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects a filled honeypot', () => {
    expect(registerSchema.safeParse({ ...valid, website: 'http://spam' }).success).toBe(false);
  });
  it('rejects password/confirm mismatch', () => {
    expect(registerSchema.safeParse({ ...valid, confirm: 'other-password' }).success).toBe(false);
  });
  it('rejects bad usernames', () => {
    for (const username of ['ab', 'a'.repeat(33), 'has space', 'ei-ääkkösiä', 'semi;colon']) {
      expect(usernameSchema.safeParse(username).success).toBe(false);
    }
  });
  it('accepts reasonable usernames', () => {
    for (const username of ['Niilo', 'user_1', 'a.b-c', 'ABC']) {
      expect(usernameSchema.safeParse(username).success).toBe(true);
    }
  });
  it('rejects short passwords', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
  });
});
