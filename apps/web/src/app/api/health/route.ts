import { NextResponse } from 'next/server'

// GET /api/health
// Used by `pullenv doctor` to check API reachability.
export function GET() {
  return NextResponse.json({ ok: true, version: '0.1.0' })
}
