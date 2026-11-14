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

`npm test` checks the drawing-convention and standards rules, the plan builder, the code-answer router and the cost figures; `npm run test:ingest` checks room tracing and PDF pages in the Python service. Without a Gemini key, everything works except reading new drawings and chat. Every new account gets a
"Pilot house" project (a three-bedroom single-storey house, `apps/shared/house-plan.ts`). `npm run ingest:fixtures` writes test drawings (vector PDF at 1:100, a scan, a DXF) to `evals/fixtures/`.

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

### How a drawing is read, and what a question costs

1. **Analyse** (Python service, no model): line work, text, scale, a render of the sheet; on scans, the symbol detector. Every page of a PDF, up to 8 per file; each page with a floor plan becomes its own revision ("Page 2 of 5").
2. **Read** (Gemini, twice per page, cached by the render's hash): rooms, labels and openings, then a second reading for doors and windows only.
3. **Measure on the drawing** (Python service, no language model): each room's outline is replaced by the exact outline of the enclosed space on the drawing, bounded by its wall lines. A room that is open to its neighbour (a doorway nobody reported, an open plan) has each edge moved onto the wall face beside it instead. Fittings and furniture are tightened onto the lines drawn for them, and the outside walls get the thickness they are drawn with. On scans and images the symbol detector (`ml/`, trained on Colab) decides where doors, windows, toilets, sinks, showers and bathtubs stand, and adds the ones the language model missed. Whatever the drawing gives no clear answer for stays as read; the plan's assumptions say which is which.
4. **Measure and save** (code): scale, walls, openings seated in walls, and for every room, opening and fitting the page and box it was read from (`src`).

The uploaded drawing is on the canvas as soon as it is rendered; the model is drawn over it when the reading is done. **Overlay** in the canvas toolbar sets how strongly the drawing and the model are drawn (in 3D the drawing lies on the floor).

Questions are answered from the stored plan. Counts, room areas, the total area, the largest or smallest room and the room list are answered by code (`apps/api/src/quick.ts`): no model call, 0¢. Everything else goes to the agent, and the answer shows what it cost at the model's list price (`GEMINI_PRICE_IN` / `GEMINI_PRICE_OUT`, US dollars per million tokens, in both `wrangler.jsonc` files: update them when the model or its price changes). Each citation carries a crop of the source sheet with the cited rooms or items outlined.

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

The marketing site uses photographs and plan sheets in `apps/web/public/photos/` (credits in the docs), not generated
images. The `site_images` table from `db/migrations/0005` is no longer read.

Set `ALLOW_SIGNUP` to `"false"` in `wrangler.jsonc` to close sign-up after creating your accounts.
