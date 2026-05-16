// api/save.js
// POST /api/save — writes transit data to Supabase
// Requires valid PIN in X-Pin header (same as ADMIN_PIN env var)
// Rate limited per IP: one write per 5 seconds

const rateStore = new Map();
const RATE_MS   = 5000; // 5 seconds between writes per IP

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

function checkRate(ip) {
  const now  = Date.now();
  const last = rateStore.get(ip) || 0;
  if (now - last < RATE_MS) return false;
  rateStore.set(ip, now);
  if (rateStore.size > 1000) {
    for (const [k, v] of rateStore) {
      if (now - v > RATE_MS * 60) rateStore.delete(k);
    }
  }
  return true;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length, 4);
  const pa  = a.padEnd(len, '\0');
  const pb  = b.padEnd(len, '\0');
  let diff  = 0;
  for (let i = 0; i < len; i++) {
    diff |= pa.charCodeAt(i) ^ pb.charCodeAt(i);
  }
  return diff === 0;
}

function clamp(v) {
  return Math.max(0, Math.min(99999, parseInt(v) || 0));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pin');
  res.setHeader('Cache-Control',                'no-store');
  res.setHeader('X-Content-Type-Options',       'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check env vars
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_PIN     = process.env.ADMIN_PIN;

  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_PIN) {
    const missing = [
      !SUPABASE_URL  && 'SUPABASE_URL',
      !SERVICE_KEY   && 'SUPABASE_SERVICE_KEY',
      !ADMIN_PIN     && 'ADMIN_PIN'
    ].filter(Boolean).join(', ');
    console.error('[save] Missing env vars:', missing);
    return res.status(500).json({ error: 'Missing environment variables: ' + missing });
  }

  // Rate limit
  const ip = getIP(req);
  if (!checkRate(ip)) {
    res.setHeader('Retry-After', '5');
    return res.status(429).json({ error: 'Too many requests — wait 5 seconds' });
  }

  // Authenticate — PIN in X-Pin header
  const submittedPin = req.headers['x-pin'] || '';
  if (!safeEqual(submittedPin, ADMIN_PIN)) {
    console.warn('[save] Auth failed from', ip);
    return res.status(401).json({ error: 'Unauthorised — invalid PIN' });
  }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
  }
  if (typeof body !== 'object' || body === null) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  // Sanitise all inputs
  const travelers  = clamp(body.travelers);
  const passengers = clamp(body.passengers);
  const fed        = clamp(body.fed);
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
          travelers,
          passengers,
          fed,
          notes,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('[save] Supabase PATCH failed:', response.status, errText);
      return res.status(502).json({ error: 'Database write failed: ' + response.status });
    }

    console.log('[save] OK ip=' + ip + ' t=' + travelers + ' p=' + passengers + ' f=' + fed);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[save] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
