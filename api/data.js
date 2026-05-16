// api/data.js
// GET /api/data — returns current transit data from Supabase
// Called by index.html every 5 seconds. No auth required (read-only public data).

module.exports = async function handler(req, res) {
  // Security headers
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control',                'no-store, no-cache');
  res.setHeader('X-Content-Type-Options',       'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_ANON_KEY;

  if (!URL || !KEY) {
    console.error('[data] SUPABASE_URL or SUPABASE_ANON_KEY missing from environment');
    return res.status(500).json({
      error: 'Server not configured — add SUPABASE_URL and SUPABASE_ANON_KEY to Vercel environment variables'
    });
  }

  try {
    const response = await fetch(
      URL + '/rest/v1/transit_data?id=eq.1&select=travelers,passengers,fed,notes,updated_at',
      {
        method: 'GET',
        headers: {
          'apikey':        KEY,
          'Authorization': 'Bearer ' + KEY,
          'Accept':        'application/json',
          'Cache-Control': 'no-cache'
        }
      }
    );

    if (!response.ok) {
      const body = await response.text();
      console.error('[data] Supabase returned', response.status, body);
      return res.status(502).json({ error: 'Database error: ' + response.status });
    }

    const rows = await response.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      // Table exists but no row yet — return safe defaults
      return res.status(200).json({
        travelers:  0,
        passengers: 0,
        fed:        0,
        notes:      '',
        updated_at: null
      });
    }

    const row = rows[0];
    return res.status(200).json({
      travelers:  Math.max(0, parseInt(row.travelers)  || 0),
      passengers: Math.max(0, parseInt(row.passengers) || 0),
      fed:        Math.max(0, parseInt(row.fed)        || 0),
      notes:      typeof row.notes === 'string' ? row.notes.slice(0, 500) : '',
      updated_at: row.updated_at || null
    });

  } catch (err) {
    console.error('[data] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
