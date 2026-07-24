/**
 * GET /api/preferences — the signed-in user's UI preferences.
 * Resolved against defaults so the client always gets a complete object.
 * Auth: proxy.ts gates the route; a valid session is additionally required
 * here to know WHICH user's preferences to return.
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/current-user';
import { resolveOverviewCards } from '@/lib/auth/types';

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    overviewCards: resolveOverviewCards(user.preferences?.overviewCards),
  });
}
