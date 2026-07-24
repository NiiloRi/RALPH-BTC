/**
 * GET /api/radar — Cycle Low Radar external series: Nasdaq 100 weekly,
 * gold weekly, BTC realized price daily. Cache-first (24h TTL,
 * data/raw/radar.json) with stale fallback. Auth-gated by src/proxy.ts.
 */

import { NextResponse } from 'next/server';
import { getRadarData } from '@/lib/data/radar-fetcher';

export async function GET() {
  try {
    const { data, stale } = await getRadarData();
    return NextResponse.json({ ...data, stale, lastUpdated: new Date().toISOString() });
  } catch (err) {
    console.error('[api/radar] failed:', err);
    return NextResponse.json({ error: 'radar data unavailable' }, { status: 503 });
  }
}
