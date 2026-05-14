// api/data.js — GET /api/data
// Reads transit data from Supabase and returns it to the viewer page.

module.exports = async function handler(req, res) {

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security headers
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('[data] Missing env vars');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  try {
    const response = await fetch(
      SUPABASE_URL + '/rest/v1/transit_data?id=eq.1&select=travelers,passengers,fed,notes,updated_at',
      {
        headers: {
          'apikey':        ANON_KEY,
          'Authorization': 'Bearer ' + ANON_KEY,
          'Accept':        'application/json'
        }
      }
    );

    if (!response.ok) {
      console.error('[data] Supabase error:', response.status);
      return res.status(502).json({ error: 'Database error' });
    }

    const rows = await response.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ error: 'No data found' });
    }

    const row = rows[0];
    return res.status(200).json({
      travelers:  Math.max(0, parseInt(row.travelers)  || 0),
      passengers: Math.max(0, parseInt(row.passengers) || 0),
      fed:        Math.max(0, parseInt(row.fed)        || 0),
      notes:      typeof row.notes === 'string' ? row.notes.slice(0, 500) : '',
      updated_at: row.updated_at || null
    });

  } catch (e) {
    console.error('[data] Error:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
