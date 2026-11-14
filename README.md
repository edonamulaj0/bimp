# bimp. — your BIM Pilot

Ask your drawings. See the answer on the sheet.

Read `docs/BIMP.md` first: it is the project's source of truth.

## Layout

| Path | What |
|---|---|
| `apps/web/index.html` | Marketing page (static) |
| `apps/web/app/`, `apps/web/src/` | App: login, projects, workspace (chat + 2D/3D canvas). Preact + three.js |
| `apps/api/src/` | Worker code. `index.ts` = web/API Worker `bimp` (auth, projects, uploads, jobs, chat). `ingest-worker.ts` = Worker `bimp-ingest` (ingestion Workflow + Container) |
| `ingest/` | Python ingestion service (PyMuPDF, OpenCV, ezdxf) for Cloudflare Containers; `make_fixtures.py` makes test drawings with known geometry |
| `apps/shared/` | Plan model and geometry used by both sides |
| `db/migrations/` | D1 schema |

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars && cp .dev.vars ingest/.dev.vars   # add GEMINI_API_KEY
python3 -m pip install -r ingest/requirements.txt
npm run db:migrate:local
npm run ingest:dev               # ingestion service on :8090 (stands in for the container; no Docker needed)
npm run dev                      # http://localhost:5173 (marketing) and /app/ (app); runs both Workers
```

`npm test` checks the drawing-convention and standards rules. Without a Gemini key, everything works except reading new drawings and chat. Every new account gets a
"Pilot house" project (an L-shaped, two-bedroom courtyard house). `npm run ingest:fixtures` writes test drawings (vector PDF at 1:100, a scan, a DXF) to `evals/fixtures/`.

## Deploy

Two Workers share one D1 database and one R2 bucket:

| Worker | Config | What | Preview links |
|---|---|---|---|
| `bimp-ingest` | `ingest/wrangler.jsonc` | Ingestion Workflow + Python Container | No (Cloudflare doesn't make version URLs for Workers with Durable Objects/Containers) |
| `bimp` | `wrangler.jsonc` (built to `apps/web/dist/bimp/wrangler.json`) | Site, app and API | Yes, per branch |

One-time setup (Workers **Paid** plan needed for Containers):

```bash
npx wrangler login
npx wrangler d1 create bimp            # paste the id into BOTH wrangler.jsonc and ingest/wrangler.jsonc
npx wrangler r2 bucket create bimp-files
npm run db:migrate:remote
npm run deploy:ingest                  # needs Docker locally (or let Workers Builds do it)
npm run deploy:web
npx wrangler secret put GEMINI_API_KEY -c ingest/wrangler.jsonc
npx wrangler secret put GEMINI_API_KEY -c apps/web/dist/bimp/wrangler.json
```

### Workers Builds (Git integration)

Connect the repo twice in the dashboard (Workers & Pages → each Worker → Settings → Build). Deploy `bimp-ingest` first.

| Setting | `bimp-ingest` | `bimp` |
|---|---|---|
| Root directory | `/` | `/` |
| Production branch | `main` | `main` |
| Build command | *(empty)* | `npm run build` |
| Deploy command | `npx wrangler deploy -c ingest/wrangler.jsonc` | `npx wrangler deploy -c apps/web/dist/bimp/wrangler.json` |
| Non-production branch builds | Off | On |
| Non-production deploy command | — | `npx wrangler versions upload -c apps/web/dist/bimp/wrangler.json` |

Every push to a non-production branch then gives a link like `https://<version>-bimp.<your-subdomain>.workers.dev`
(shown on the build and in the PR check). Preview versions use the **same** D1 and R2 as production.
Version URLs are public: put Cloudflare Access in front if the data must stay private.

### Architectural images (Cloudinary, optional)

The 3D view can generate architectural images (the model set in a garden, a street at dusk, a 16:9 panorama, or a
presentation board) with Cloudinary's generative AI. Enable generative AI on your Cloudinary account, then:

```bash
# in wrangler.jsonc "vars": CLOUDINARY_CLOUD_NAME and CLOUDINARY_API_KEY
npx wrangler secret put CLOUDINARY_API_SECRET -c apps/web/dist/bimp/wrangler.json
npm run db:migrate:remote   # adds the visuals table (0004)
```

Snapshots are uploaded with signed requests into `bimp/<project id>/`, and each image is generated as an eager
transformation, so it works with "strict transformations" on. Generative styles use Cloudinary credits; each user can
make 20 images a day.

Set `ALLOW_SIGNUP` to `"false"` in `wrangler.jsonc` to close sign-up after creating your accounts.
