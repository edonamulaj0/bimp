# bimp. — your BIM Pilot

Ask your drawings. See the answer on the sheet.

Read `docs/BIMP.md` first: it is the project's source of truth.

## Layout

| Path | What |
|---|---|
| `apps/web/index.html` | Marketing page (static) |
| `apps/web/app/`, `apps/web/src/` | App: login, projects, workspace (chat + 2D canvas). Preact |
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

`npm test` checks the drawing-convention and standards rules, the plan builder, the code-answer router and the cost figures; `npm run test:ingest` checks room tracing and PDF pages in the Python service. The model is Gemini 4 Hydrogen (`GEMINI_MODEL` in both `wrangler.jsonc` files; `GEMINI_THINKING` sets its thinking level, empty for the default). Without a Gemini key, everything works except reading new drawings and chat. Every new account gets a
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
   Then fittings and furniture are read a second time on enlarged, overlapping pieces of the plan (up to 3 × 3, each cached like the first reading): a chair or a bedside table is a few pixels on the whole sheet. What a piece sees is placed more exactly and wins where both readings report the same thing; what only the first reading has stays. Set `ZOOM_FURNITURE` to `off` in `ingest/wrangler.jsonc` to skip it.
3. **Measure on the drawing** (Python service, no language model): each room's outline is replaced by the exact outline of the enclosed space on the drawing, bounded by its wall lines. A room that is open to its neighbour (a doorway nobody reported, an open plan) has each edge moved onto the wall face beside it instead. Where the drawing has its walls filled solid along most of the rooms' outline, the walls shown are the drawing's own: the filled strokes are traced as polygons (`plan.poche`), so every thickness, pier, tower and curve is as drawn, and a door is kept only where that wall has its gap. Where walls are thin lines or hatched, they are built from the room outlines as before, but only where something is drawn: a boundary with nothing along it (an open plan, a line the reading invented) gets no wall. A wall drawn as a curve is measured as an arc of a circle through its face (a bay of straight walls, or a door's swing, is not one) and kept as one curved wall with its radius. Fittings and furniture are moved onto the lines drawn for them: the symbol's own strokes, or the rectangle drawn along its sides, also when the reading put it up to its own size off; one read where the sheet is empty is left out, one read twice is kept once, and none reaches into a wall. Each keeps its box exactly and is only turned so that its back is on the wall behind it (a bed's head and a toilet's cistern on a short side, a sofa and a worktop on a long one), so nothing is drawn at an angle the drawing does not show. The outside walls get the thickness they are drawn with. On scans and images the symbol detector (`ml/`, trained on Colab) decides where doors, windows, toilets, sinks, showers and bathtubs stand, and adds the ones the language model missed. The reading gives each room its shape; measuring only moves its walls onto the lines of the drawing, square to the drawing's axes, and a traced outline is used only when it is clean (no kinks round door leaves, hatching or handwriting). Whatever the drawing gives no clear answer for stays as read; the plan's assumptions say which is which. Set `MEASURE_ON_DRAWING` to `off` in `ingest/wrangler.jsonc` to switch this step off.
4. **Measure and save** (code): scale, walls, openings seated in walls, and for every room, opening and fitting the page and box it was read from (`src`).

**What a question costs.** Nothing is read twice: a reading is cached by the hash of the rendered sheet. Questions are answered in this order:

1. **By code** (counts, areas, room sizes): no model call.
2. **From the answer cache**: the same question about the same plan, after the same turns, gets the answer that already passed the check (`answer_cache`; any change to the plan changes the key).
3. **By the model, from the plan's reference file**: one Markdown document per plan, written by code from the stored plan with the functions the chat's tools use (`apps/api/src/brief.ts`): how far to trust it, totals, counts, every room with its openings and fittings, doors and windows, walls, checks against standards, escape distances, and the text written on the sheet. It is the first thing in every request for that plan, so most questions take one model call instead of a round of look-ups, and the provider bills the repeated prefix at its cached rate. Tools remain for arithmetic, standards, occupancy and feng shui. Every figure in an answer is still checked against the file and the tool results.

Each revision's reference file can be opened from the Revisions panel (`GET /api/projects/:id/revisions/:rid/reference`).

The uploaded drawing is on the canvas as soon as it is rendered; the model is drawn over it when the reading is done. **Overlay** in the canvas toolbar sets how strongly the drawing and the plan are drawn.

Symbols: bimp names 29 kinds of fitting, appliance and furniture. One it cannot name is drawn dashed with a "?" pin; anyone on the project can say what it is, and each answer is stored with its place on the sheet (`symbol_labels`) as an example for the next symbol model. Hovering a wall, door, window or symbol on the 2D plan shows what it is and its measurements, whether or not the drawing states them; the chat has the same figures (`list_walls`, `list_openings`, `list_fixtures`).

Questions are answered from the stored plan. Counts, room areas, the total area, the largest or smallest room and the room list are answered by code (`apps/api/src/quick.ts`): no model call, 0¢. Everything else goes to the agent, and the answer shows what it cost at the model's list price (`GEMINI_PRICE_IN` / `GEMINI_PRICE_OUT`, US dollars per million tokens, in both `wrangler.jsonc` files: update them when the model or its price changes). Each citation carries a crop of the source sheet with the cited rooms or items outlined.

### Cloudinary (optional)

Two things use Cloudinary; both are off until its three settings are present (`CLOUDINARY_CLOUD_NAME` and
`CLOUDINARY_API_KEY` in `wrangler.jsonc`, `CLOUDINARY_API_SECRET` as a secret):

```bash
npx wrangler secret put CLOUDINARY_API_SECRET -c apps/web/dist/bimp/wrangler.json
```

- **Presentation images** (the Images button on the canvas): a snapshot of the 2D plan, as a sheet, is set on a
  drawing desk, a site office table or a presentation board. The scenes use Cloudinary's generative AI, which must be
  enabled on the account and uses its credits; each person can make 20 images a day. Scene prompts are plain words
  only: a comma or slash in a prompt breaks the image URL, so `cleanPrompt` removes them.
- **Evidence images** ("Share as image" under a citation's crop): Cloudinary cuts the cited piece out of the source
  sheet and serves it from its CDN, so the proof of an answer can be pasted into a report or a message. The sheet is
  uploaded once per drawing, into `bimp/<project id>/sheets/`. This sends the drawing to Cloudinary.

### Site images

The marketing site uses photographs and plan sheets in `apps/web/public/photos/` (credits in the docs), not generated
images. `db/migrations/0008` drops the unused `site_images` table and clears the images of the removed 3D view from `visuals`. The app is 2D only: the 3D view was removed, and presentation images are made from the 2D plan.

Set `ALLOW_SIGNUP` to `"false"` in `wrangler.jsonc` to close sign-up after creating your accounts.
