'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/current-user';
import { deleteUser, setUserStatus } from '@/lib/auth/user-store';

/**
 * Admin mutations. Server actions are public HTTP endpoints — every one
 * re-authenticates as admin first; the page gate alone proves nothing.
 * Last-active-admin protection lives in the store (throws); the UI also
 * hides those buttons, so a throw here means someone bypassed the UI.
 */

export async function activateUserAction(id: string): Promise<void> {
  await requireAdmin();
  await setUserStatus(id, 'active');
  revalidatePath('/admin');
}

export async function disableUserAction(id: string): Promise<void> {
  await requireAdmin();
  await setUserStatus(id, 'disabled');
  revalidatePath('/admin');
}

export async function deleteUserAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteUser(id);
  revalidatePath('/admin');
}
