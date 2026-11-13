# bimp. — your BIM Pilot

Ask your drawings. See the answer on the sheet.

Read `docs/BIMP.md` first: it is the project's source of truth.

## Layout

| Path | What |
|---|---|
| `apps/web/index.html` | Marketing page (static) |
| `apps/web/app/`, `apps/web/src/` | App: login, projects, workspace (chat + 2D/3D canvas). Preact + three.js |
| `apps/api/src/` | Cloudflare Worker API (Hono): auth, projects, uploads, plan extraction, chat agent |
| `apps/shared/` | Plan model and geometry used by both sides |
| `db/migrations/` | D1 schema |

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # add GEMINI_API_KEY to enable upload extraction and chat
npm run db:migrate:local
npm run dev                      # http://localhost:5173 (marketing) and /app/ (app)
```

Without a Gemini key, everything works except reading new drawings and chat. Every new account gets a
"Sample house" project so the 2D/3D canvas can be tried straight away.

## Deploy

```bash
npx wrangler d1 create bimp      # paste the id into wrangler.jsonc
npx wrangler r2 bucket create bimp-files
npm run db:migrate:remote
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

Set `ALLOW_SIGNUP` to `"false"` in `wrangler.jsonc` to close sign-up.
