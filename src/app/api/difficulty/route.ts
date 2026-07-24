/**
 * GET /api/difficulty — Bitcoin network difficulty history.
 *
 * Cache-first (24h TTL on data/raw/difficulty.json inside the persistent
 * volume) with a stale-cache fallback when blockchain.info is unreachable.
 * Auth: gated automatically by src/proxy.ts (its matcher covers /api/*).
 */

import { NextResponse } from 'next/server';
import { getDifficultyData } from '@/lib/data/difficulty-fetcher';

export async function GET() {
  try {
    const { points, stale } = await getDifficultyData();
    return NextResponse.json({
      points,
      stale,
      lastUpdated: new Date().toISOString(),
      source: 'blockchain.info',
    });
  } catch (err) {
    console.error('[api/difficulty] failed:', err);
    return NextResponse.json(
      { error: 'difficulty data unavailable' },
      { status: 503 }
    );
  }
}
