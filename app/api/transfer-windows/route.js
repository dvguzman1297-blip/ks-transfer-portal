import { NextResponse } from 'next/server';
import { serviceClient, windowOptions } from '../../../lib/openCycles.js';
import { clientIp } from '../../../lib/http.js';
import { makeLimiter } from '../../../lib/playerLookup.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rateLimited = makeLimiter(30);

// Public: the names of the cycles a visitor can request a transfer for, plus the label of the "next window" option.
// Nothing else about a cycle is exposed.
export async function GET(request) {
  const sb = serviceClient();
  if (!sb) return NextResponse.json({ success: false, error: 'Transfer requests are not set up yet' }, { status: 503 });
  if (rateLimited(clientIp(request))) return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  try {
    const { windows, next } = await windowOptions(sb);
    return NextResponse.json({ success: true, windows, next: { label: next.label } });
  } catch (err) {
    console.error('transfer-windows failed:', err?.message || err);
    return NextResponse.json({ success: false, error: 'Could not load transfer windows' }, { status: 500 });
  }
}
