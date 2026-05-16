// api/verify.js
// POST /api/verify — checks if the submitted PIN matches ADMIN_PIN env var
// Used exclusively by admin.html login gate.
// Separated from /api/save so rate limiting on save never blocks login.

// Simple timing-safe comparison to prevent PIN brute-force via timing
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

// Per-IP attempt tracking to prevent brute force
const attempts = new Map();
const MAX_ATTEMPTS  = 10;
const WINDOW_MS     = 5 * 60 * 1000; // 5 minute window

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

function isBlocked(ip) {
  const record = attempts.get(ip);
  if (!record) return false;
  // Reset window if expired
  if (Date.now() - record.since > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordAttempt(ip) {
  const record = attempts.get(ip);
  if (!record || Date.now() - record.since > WINDOW_MS) {
    attempts.set(ip, { count: 1, since: Date.now() });
  } else {
    record.count++;
  }
}

function clearAttempts(ip) {
  attempts.delete(ip);
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

  const ADMIN_PIN = process.env.ADMIN_PIN;
  if (!ADMIN_PIN) {
    console.error('[verify] ADMIN_PIN not set in environment variables');
    return res.status(500).json({
      error: 'ADMIN_PIN not configured — add it to Vercel environment variables'
    });
  }

  const ip = getIP(req);

  if (isBlocked(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 5 minutes.' });
  }

  // Read PIN from X-Pin header (not body, not URL)
  const submittedPin = req.headers['x-pin'] || '';

  if (!submittedPin) {
    return res.status(400).json({ error: 'No PIN provided' });
  }

  if (safeEqual(submittedPin, ADMIN_PIN)) {
    clearAttempts(ip);
    console.log('[verify] PIN accepted from', ip);
    return res.status(200).json({ ok: true });
  } else {
    recordAttempt(ip);
    const record = attempts.get(ip) || { count: 1 };
    const left   = Math.max(0, MAX_ATTEMPTS - record.count);
    console.warn('[verify] Wrong PIN from', ip, '— attempts left:', left);
    return res.status(401).json({
      error: 'Incorrect PIN',
      attemptsLeft: left
    });
  }
};
