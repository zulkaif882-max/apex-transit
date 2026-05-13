// api/data.js
// GET /api/data
// Fetches current transit data from Supabase and returns it to viewers.
// No auth required — data is read-only and non-sensitive.

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security headers
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('Referrer-Policy',         'no-referrer');
  res.setHeader('Cache-Control',           'no-store, no-cache, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');   // viewer is public

  // Validate env vars are present
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('[data] Missing Supabase environment variables');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/transit_data?id=eq.1&select=travelers,passengers,fed,notes,updated_at`,
      {
        signal: controller.signal,
        headers: {
          'apikey':        process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Accept':        'application/json',
        }
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      console.error('[data] Supabase error:', response.status, await response.text());
      return res.status(502).json({ error: 'Upstream error' });
    }

    const rows = await response.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'No data found' });
    }

    const row = rows[0];

    // Validate and sanitise the outgoing payload — never expose raw DB object
    const safe = {
      travelers:  Math.max(0, parseInt(row.travelers)  || 0),
      passengers: Math.max(0, parseInt(row.passengers) || 0),
      fed:        Math.max(0, parseInt(row.fed)        || 0),
      notes:      typeof row.notes === 'string' ? row.notes.slice(0, 500) : '',
      updated_at: row.updated_at || null,
    };

    return res.status(200).json(safe);

  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('[data] Supabase request timed out');
      return res.status(504).json({ error: 'Gateway timeout' });
    }
    console.error('[data] Unexpected error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
