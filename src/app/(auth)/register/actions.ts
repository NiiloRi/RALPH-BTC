'use server';

import { headers } from 'next/headers';
import { hashPassword } from '@/lib/auth/password';
import {
  getClientIp,
  registerIpDayLimiter,
  registerIpHourLimiter,
} from '@/lib/auth/rate-limit';
import { MIN_FORM_FILL_MS, verifyFormToken } from '@/lib/auth/session';
import { registerSchema } from '@/lib/auth/types';
import { createUser, UsernameTakenError } from '@/lib/auth/user-store';

export interface RegisterFormState {
  error?: string;
  /** true → show the "awaiting approval" success screen */
  success?: boolean;
}

/** What bots get: indistinguishable from a real success, but nothing is stored. */
const FAKE_SUCCESS: RegisterFormState = { success: true };

export async function registerAction(
  _prev: RegisterFormState,
  formData: FormData
): Promise<RegisterFormState> {
  // Honeypot before anything else — bots that fill it get a quiet fake success.
  const honeypot = formData.get('website');
  if (typeof honeypot === 'string' && honeypot.length > 0) return FAKE_SUCCESS;

  const parsed = registerSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    website: honeypot ?? '',
    ft: formData.get('ft'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  // Signed timing token: form must have existed ≥ 3s (bots submit instantly).
  const tokenInfo = await verifyFormToken(parsed.data.ft, 'register');
  if (!tokenInfo) return { error: 'Form expired — reload the page and try again' };
  if (Date.now() - tokenInfo.iatMs < MIN_FORM_FILL_MS) return FAKE_SUCCESS;

  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const hourGate = registerIpHourLimiter.consume(`ip:${ip}`);
  const dayGate = registerIpDayLimiter.consume(`ip:${ip}`);
  if (!hourGate.ok || !dayGate.ok) {
    return { error: 'Too many registrations from your network — try again later' };
  }

  try {
    await createUser({
      username: parsed.data.username,
      passwordHash: await hashPassword(parsed.data.password),
      registrationIp: ip,
      registrationUserAgent: hdrs.get('user-agent') ?? undefined,
    });
  } catch (e) {
    if (e instanceof UsernameTakenError) {
      // Acceptable enumeration for a private tool; the alternative (fake
      // success) would break legitimate users. Rate limits bound abuse.
      return { error: 'Username already taken' };
    }
    throw e;
  }

  return { success: true };
}
