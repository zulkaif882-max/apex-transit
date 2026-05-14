// api/save.js — POST /api/save
// Receives data from admin.html and saves it to Supabase.
// Protected by PIN verification, rate limiting, and input validation.

// In-memory rate limit store (resets on cold start)
const rateStore = new Map();
const RATE_WINDOW = 8000; // 8 seconds between saves per IP

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress
    || 'unknown';
}

function checkRate(ip) {
  const now  = Date.now();
  const last = rateStore.get(ip) || 0;
  if (now - last < RATE_WINDOW) return false;
  rateStore.set(ip, now);
  // Clean up old entries
  if (rateStore.size > 500) {
    for (const [k, v] of rateStore) {
      if (now - v > RATE_WINDOW * 10) rateStore.delete(k);
    }
  }
  return true;
}

// Timing-safe string comparison — prevents PIN timing attacks
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length, 4);
  const pa  = a.padEnd(len, '\0');
  const pb  = b.padEnd(len, '\0');
  let diff  = pa.length !== pb.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    diff |= pa.charCodeAt(i) ^ pb.charCodeAt(i);
  }
  return diff === 0;
}

module.exports = async function handler(req, res) {

  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_PIN     = process.env.ADMIN_PIN;

  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_PIN) {
    console.error('[save] Missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Rate limit
  const ip = getIP(req);
  if (!checkRate(ip)) {
    res.setHeader('Retry-After', '8');
    return res.status(429).json({ error: 'Too many requests — wait 8 seconds' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (typeof body !== 'object' || body === null) {
    return res.status(400).json({ error: 'Invalid body' });
  }

  // PIN check — reads from X-Session-Token header
  const pin = req.headers['x-session-token'] || '';
  if (!safeEqual(pin, ADMIN_PIN)) {
    console.warn('[save] Bad PIN from', ip);
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // Sanitise inputs
  const travelers  = Math.max(0, Math.min(99999, parseInt(body.travelers)  || 0));
  const passengers = Math.max(0, Math.min(99999, parseInt(body.passengers) || 0));
  const fed        = Math.max(0, Math.min(99999, parseInt(body.fed)        || 0));
  const notes      = (typeof body.notes === 'string' ? body.notes : '')
                       .trim().slice(0, 500).replace(/[<>]/g, '');

  // Write to Supabase
  try {
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/transit_data?id=eq.1',
      {
        method: 'PATCH',
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify({
          travelers, passengers, fed, notes,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('[save] Supabase error:', response.status, err);
      return res.status(502).json({ error: 'Database write failed' });
    }

    console.log('[save] OK — travelers:' + travelers + ' passengers:' + passengers + ' fed:' + fed + ' ip:' + ip);
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error('[save] Error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
