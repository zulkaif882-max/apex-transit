// api/save.js
// POST /api/save
// Receives updated transit data from the admin panel and writes it to Supabase.
// Protected by:
//   1. Server-side PIN verification
//   2. Input validation & sanitisation
//   3. Server-side rate limiting (one write per 8s per IP)
//   4. Request size limit
//   5. Security headers on all responses

// ── Config ────────────────────────────────────────────────────────────────────
// Set ADMIN_PIN in your Vercel environment variables — do NOT hardcode here.
// Run: vercel env add ADMIN_PIN
// Then set it to the same 4-digit code used in admin.html.
// This gives you true server-side PIN enforcement independent of the client.

const MAX_BODY_BYTES     = 4096;       // 4 KB request body limit
const MAX_NUMBER         = 99999;      // max value for numeric fields
const MAX_NOTES_LENGTH   = 500;        // max notes length
const RATE_LIMIT_WINDOW  = 8000;       // 8 seconds between writes per IP

// In-memory rate limit store (resets on cold start — acceptable for this use case)
// For production at scale, use Upstash Redis instead.
const rateLimitStore = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');
  res.setHeader('Referrer-Policy',        'no-referrer');
  res.setHeader('Cache-Control',          'no-store');
  res.setHeader('Content-Type',           'application/json');
  // Restrict CORS — only same origin can call this endpoint
  res.setHeader('Access-Control-Allow-Origin',  'same-origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
}

function clamp(val, max = MAX_NUMBER) {
  const n = parseInt(val);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(max, n));
}

function sanitiseNotes(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .slice(0, MAX_NOTES_LENGTH)
    .replace(/[<>]/g, '')       // strip HTML angle brackets
    .replace(/\0/g, '');        // strip null bytes
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now  = Date.now();
  const last = rateLimitStore.get(ip) || 0;
  if (now - last < RATE_LIMIT_WINDOW) {
    return false; // too soon
  }
  rateLimitStore.set(ip, now);

  // Periodically clean up old entries to avoid memory leaks
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore) {
      if (now - v > RATE_LIMIT_WINDOW * 10) rateLimitStore.delete(k);
    }
  }

  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecurityHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate env vars
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('[save] Missing Supabase environment variables');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // ── 1. Request size check ─────────────────────────────────────────────────
  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request too large' });
  }

  // ── 2. Rate limit per IP ──────────────────────────────────────────────────
  const ip = getClientIP(req);
  if (!checkRateLimit(ip)) {
    res.setHeader('Retry-After', '8');
    return res.status(429).json({ error: 'Too many requests — please wait before publishing again' });
  }

  // ── 3. Parse body ─────────────────────────────────────────────────────────
  let body;
  try {
    // req.body is pre-parsed by Vercel for application/json
    body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    if (typeof body !== 'object' || body === null) throw new Error('Not an object');
  } catch(e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // ── 4. PIN verification (server-side) ─────────────────────────────────────
  // ADMIN_PIN env var must be set via: vercel env add ADMIN_PIN
  // If not set, fall back to a deny-all posture
  const serverPin = process.env.ADMIN_PIN;
  if (!serverPin) {
    console.error('[save] ADMIN_PIN environment variable not set');
    return res.status(500).json({ error: 'Admin PIN not configured on server' });
  }

  // PIN should be sent in the X-Session-Token header OR in the body as _pin
  // Using header is slightly safer (not logged in most request loggers)
  const submittedPin = req.headers['x-session-token'] || body._pin || '';

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(submittedPin, serverPin)) {
    console.warn(`[save] Failed PIN attempt from ${ip}`);
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // ── 5. Validate & sanitise inputs ─────────────────────────────────────────
  const travelers  = clamp(body.travelers);
  const passengers = clamp(body.passengers);
  const fed        = clamp(body.fed);
  const notes      = sanitiseNotes(body.notes);

  // Business logic validation
  if (passengers > travelers) {
    return res.status(422).json({ error: 'OK Passengers cannot exceed Total Travelers' });
  }
  if (fed > travelers) {
    return res.status(422).json({ error: 'Fed Count cannot exceed Total Travelers' });
  }

  // ── 6. Write to Supabase ──────────────────────────────────────────────────
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/transit_data?id=eq.1`,
      {
        method: 'PATCH',
        signal: controller.signal,
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({
          travelers,
          passengers,
          fed,
          notes,
          updated_at: new Date().toISOString(),
        })
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[save] Supabase PATCH error:', response.status, errText);
      return res.status(502).json({ error: 'Database write failed' });
    }

    console.log(`[save] ✓ Data updated by ${ip} — travelers:${travelers} passengers:${passengers} fed:${fed}`);
    return res.status(200).json({ ok: true });

  } catch(e) {
    if (e.name === 'AbortError') {
      console.error('[save] Supabase request timed out');
      return res.status(504).json({ error: 'Gateway timeout' });
    }
    console.error('[save] Unexpected error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Timing-safe string comparison ─────────────────────────────────────────────
// Prevents attackers from guessing the PIN digit-by-digit via response timing.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Pad to same length before comparing to avoid length leak
  const len = Math.max(a.length, b.length, 4);
  const pa  = a.padEnd(len, '\0');
  const pb  = b.padEnd(len, '\0');
  let diff  = pa.length !== pb.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    diff |= pa.charCodeAt(i) ^ pb.charCodeAt(i);
  }
  return diff === 0;
}
