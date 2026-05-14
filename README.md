# APEX TRANSIT — Operations Dashboard

A real-time transit operations dashboard with a live viewer and a secured admin panel.

## Project Structure

```
apex-transit/
├── public/               ← Deployed to Vercel (browser files)
│   ├── index.html        ← Live viewer dashboard
│   └── admin.html        ← Secured operator admin panel (PIN protected)
│
├── api/                  ← Vercel serverless functions (backend)
│   ├── data.js           ← GET /api/data  — reads from Supabase
│   └── save.js           ← POST /api/save — writes to Supabase (PIN + rate limited)
│
├── local-server/         ← Run locally without Vercel/Supabase
│   ├── server.js         ← Node.js server (run: node server.js)
│   └── data.json         ← Local data store
│
├── docs/
│   └── GUIDE.html        ← Full beginner deployment guide
│
├── vercel.json           ← Vercel routing configuration
├── .env.example          ← Environment variable template
├── .gitignore            ← Prevents secrets being committed
└── README.md             ← This file
```

## Quick Start

### Option A — Local Network (no internet needed)
```bash
cd local-server
node server.js
# Open http://localhost:3000 for viewer
# Open http://localhost:3000/admin.html for admin
```

### Option B — Deploy to Vercel + Supabase
See `docs/GUIDE.html` for the complete step-by-step beginner guide.

**Required environment variables in Vercel:**
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
ADMIN_PIN=1234
```

## Security Features
- PIN-protected admin panel with 5-attempt lockout
- 15-minute session timeout with re-authentication
- Server-side PIN verification (timing-safe comparison)
- Per-IP rate limiting on the save endpoint
- Input sanitisation and validation on all fields
- CSP, X-Frame-Options, and security headers throughout
- No secrets in any HTML or JS files

## URLs (after deployment)
| Page | URL |
|---|---|
| Viewer | `https://your-site.vercel.app` |
| Admin | `https://your-site.vercel.app/admin.html` |
| Guide | Open `docs/GUIDE.html` in a browser |
