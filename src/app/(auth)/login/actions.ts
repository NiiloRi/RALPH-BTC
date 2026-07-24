'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sanitizeNextParam } from '@/lib/auth/gate';
import { DUMMY_HASH, verifyPassword } from '@/lib/auth/password';
import { getClientIp, loginIpLimiter, loginUserLimiter } from '@/lib/auth/rate-limit';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth/session';
import { loginSchema } from '@/lib/auth/types';
import { getUserByUsername, recordLogin } from '@/lib/auth/user-store';

export interface LoginFormState {
  error?: string;
}

const GENERIC_ERROR = 'Invalid username or password';

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const parsed = loginSchema.safeParse({
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: GENERIC_ERROR };
  const { username, password } = parsed.data;

  const ip = getClientIp(await headers());
  const ipGate = loginIpLimiter.consume(`ip:${ip}`);
  const userGate = loginUserLimiter.consume(`user:${username.toLowerCase()}`);
  if (!ipGate.ok || !userGate.ok) {
    const retryMs = Math.max(
      !ipGate.ok ? ipGate.retryAfterMs : 0,
      !userGate.ok ? userGate.retryAfterMs : 0
    );
    return { error: `Too many attempts — try again in ${Math.ceil(retryMs / 60_000)} min` };
  }

  const user = await getUserByUsername(username);
  if (!user) {
    // timing-flat: unknown user costs the same as a wrong password
    await verifyPassword(password, DUMMY_HASH);
    return { error: GENERIC_ERROR };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { error: GENERIC_ERROR };
  }

  // Status messages only AFTER a correct password — leaks nothing an attacker
  // doesn't already have, and tells legitimate users what's going on.
  if (user.status === 'pending') {
    return { error: 'Account awaiting admin approval' };
  }
  if (user.status === 'disabled') {
    return { error: 'Account disabled' };
  }

  loginUserLimiter.reset(`user:${user.usernameLower}`);
  await recordLogin(user.id);

  const token = await signSession({
    sub: user.id,
    username: user.username,
    role: user.role,
    v: user.tokenVersion,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

  redirect(sanitizeNextParam(formData.get('next') as string | null));
}
