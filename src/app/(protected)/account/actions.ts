'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/current-user';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth/session';
import { changePasswordSchema, overviewCardsSchema, type OverviewCardPrefs } from '@/lib/auth/types';
import { updatePassword, updatePreferences } from '@/lib/auth/user-store';

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

/**
 * Persist which overview cards are visible for this user. Called
 * programmatically from the settings toggles (optimistic client state,
 * fire-and-forget persistence). Re-authenticates like every action.
 */
export async function updateOverviewCardsAction(
  cards: OverviewCardPrefs
): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = overviewCardsSchema.safeParse(cards);
  if (!parsed.success) return { error: 'Invalid preferences' };
  await updatePreferences(user.id, { overviewCards: parsed.data });
  return {};
}

export interface ChangePasswordState {
  error?: string;
  success?: boolean;
}

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await requireUser(); // actions are public endpoints — re-auth first

  const parsed = changePasswordSchema.safeParse({
    current: formData.get('current'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return { error: 'Current password is incorrect' };
  }

  // Bumps tokenVersion → every other session dies on its next request…
  const newVersion = await updatePassword(user.id, await hashPassword(parsed.data.password));

  // …then re-issue THIS session's cookie with the new version so it survives.
  const token = await signSession({
    sub: user.id,
    username: user.username,
    role: user.role,
    v: newVersion,
  });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());

  return { success: true };
}
