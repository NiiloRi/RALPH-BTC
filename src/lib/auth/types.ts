/**
 * Auth layer — shared types and validation schemas.
 *
 * Whole-site login with admin-approved self-registration:
 * anyone may register (status 'pending'); only an admin activation in /admin
 * makes the account usable. See src/proxy.ts for the request gate.
 */

import { z } from 'zod';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'active' | 'disabled';

/**
 * Overview cards the user can show/hide. The main verdict card is always
 * visible for everyone and deliberately NOT in this list.
 */
export const OVERVIEW_CARDS = [
  { key: 'riskStrip', label: 'Risk-colored price (12 months)' },
  { key: 'fan', label: 'Quantile fan (12 months)' },
  { key: 'powerLaw', label: 'Power law mini' },
  { key: 's2f', label: 'Stock-to-flow mini' },
  { key: 'difficulty', label: 'Difficulty mini' },
] as const;

export type OverviewCardKey = (typeof OVERVIEW_CARDS)[number]['key'];
export type OverviewCardPrefs = Record<OverviewCardKey, boolean>;

/** Default: everything visible (matches pre-preferences behavior). */
export function defaultOverviewCards(): OverviewCardPrefs {
  return { riskStrip: true, fan: true, powerLaw: true, s2f: true, difficulty: true };
}

/** Merge stored prefs over defaults (missing/new keys default to visible). */
export function resolveOverviewCards(stored?: Partial<OverviewCardPrefs>): OverviewCardPrefs {
  return { ...defaultOverviewCards(), ...(stored ?? {}) };
}

export interface UserPreferences {
  overviewCards?: Partial<OverviewCardPrefs>;
}

export interface UserRecord {
  id: string;
  /** Display form, as typed at registration */
  username: string;
  /** Lowercased unique key (case-insensitive uniqueness) */
  usernameLower: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  /** Bumped on disable / password change → old JWTs die on next request */
  tokenVersion: number;
  createdAt: string;
  activatedAt?: string;
  lastLoginAt?: string;
  registrationIp?: string;
  registrationUserAgent?: string;
  /** Per-user UI preferences (e.g. which overview cards are visible) */
  preferences?: UserPreferences;
}

/** Session cookie JWT claims */
export interface SessionClaims {
  sub: string;
  username: string;
  role: UserRole;
  /** tokenVersion at issue time; must match the stored user */
  v: number;
}

/** What the admin portal renders — never includes the hash */
export type PublicUser = Omit<UserRecord, 'passwordHash' | 'usernameLower'>;

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    status: u.status,
    tokenVersion: u.tokenVersion,
    createdAt: u.createdAt,
    activatedAt: u.activatedAt,
    lastLoginAt: u.lastLoginAt,
    registrationIp: u.registrationIp,
    registrationUserAgent: u.registrationUserAgent,
  };
}

// ---- validation schemas -----------------------------------------------------

export const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_.-]+$/, 'Only letters, numbers and _ . - allowed');

// Max 72: bcrypt truncates at 72 bytes — longer passwords would silently collide.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(72),
});

export const registerSchema = z
  .object({
    username: usernameSchema,
    password: passwordSchema,
    confirm: z.string(),
    /** Honeypot — humans never see it; any content marks the submission as a bot */
    website: z.string().max(0).optional().or(z.literal('')),
    /** Signed form token minting time — enforces a minimum fill time */
    ft: z.string().min(1),
  })
  .refine(d => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export const overviewCardsSchema = z.object({
  riskStrip: z.boolean(),
  fan: z.boolean(),
  powerLaw: z.boolean(),
  s2f: z.boolean(),
  difficulty: z.boolean(),
});

export const changePasswordSchema = z
  .object({
    current: z.string().min(1, 'Current password is required').max(72),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine(d => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
