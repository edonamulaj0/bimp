# BIMP — Project Source of Truth

> **BIMP — your BIM Pilot.**
> Ask your drawings. See the answer on the sheet.

This file is the single source of truth for BIMP. Read it in full before working on anything in this project.
The work plan from here to judging is in `docs/PLAN.md`.
If code, a conversation, or another document disagrees with this file, this file wins — or update it in the same
change. Sections marked **VERIFY** are assumptions that have not been confirmed yet; check them before relying on them.

---

## 1. Context

### 1.1 The challenge (hackathon brief)

> Build a program that answers natural language questions about construction drawings and building information
> models accurately and verifiably. Construction site engineers spend hours every day looking for information.
> General-purpose AI models frequently fail when analyzing complex technical drawings. This is one of the hardest
> unsolved problems in construction tech. You will get a dataset of real technical drawings in many formats and
> languages together with example questions. A great answer is correct and shows where in the drawing it came from
> so a human can verify it in seconds. We are interested in solutions which next year's frontier models won't make
> obsolete — e.g. hybrid solutions combining frontier models, computer vision, 3D, geometry or small fine-tuned models.

### 1.2 What BIMP is

A web app where a construction professional uploads a drawing set (PDF, DWG/DXF, IFC, scans — any language), asks a
question in plain words, and gets an answer **plus the evidence**: the sheet, the grid location and a highlighted
crop of the exact spot it came from. The workspace has two panes: **chat** (asks and answers) and **canvas** (shows
and proves).

The name: **BIMP = BIM Pilot.** BIM is Building Information Modeling; a *pilot* is the one who knows the way and
guides you through it. BIMP guides engineers through drawing sets and models to the exact spot an answer lives.
Written **BIMP** (all caps) in text and logo; spoken "bimp".

### 1.3 Who it's for

- **Site engineers** — need one number or note fast, on a laptop or tablet in a site office.
- **Project managers** — need quantities, counts and cross-checks between sheets.
- **Contractors / estimators** — need quantity take-offs they can defend.

They are practical, busy and skeptical of hype. They trust a tool that shows its work.

### 1.4 Dataset

- **Preview set:** ~0.5 GB. Build and iterate on this.
- **Full set:** ~10 GB. Design for it from day one; run full ingestion before judging.
- Mixed formats and languages, plus example questions from the organizers.
- **VERIFY:** format mix (vector PDF vs scans vs DWG/DXF vs IFC), languages present, whether judging uses the full
  set or a hidden set, and whether the data may be stored on Cloudflare / Google / Cloudinary / Aiven (data rights).

---

## 2. Principles (non-negotiable)

1. **No source, no answer.** Every factual claim carries a citation (sheet, page, bbox, source item). If nothing in
   the index supports an answer, say "Not found in the drawings" — never guess.
2. **The model reads, the tools measure.** Exact values come from extracted text, geometry, tables and IFC data.
   The LLM plans, calls tools and writes the answer; it does not invent numbers or estimate from a downscaled image.
3. **Show the work.** Quantities show inputs, formula, assumptions and result. Conflicts between sources are shown,
   not resolved silently.
4. **The model is swappable.** All intelligence that must stay correct lives in the index and the tools. A better
   model next year should make BIMP better, not obsolete.
5. **Verify in seconds.** Every citation opens the canvas zoomed to the highlighted region.
6. **Ingest once, answer fast.** Heavy processing happens at ingestion and is cached; question time is queries plus
   a few model calls.
7. **Honest UI.** Never show a capability that isn't built. Anything approximate (e.g. a 3D massing generated from
   2D) is labelled as a preview.

---

## 3. Scope

### 3.1 MVP (must have for judging)

- Ingestion of vector PDFs (+ OCR fallback for scanned pages) into the index.
- Sheet understanding: title block, schedules/tables, notes, legend, grid lines, cross-references (callouts).
- Question answering with citations for: **lookup, schedule, cross-sheet, count, measure/quantity**.
- Verification pass on every answer (see §7).
- Two-pane workspace: chat + 2D canvas with highlights and zoom-to-evidence.
- Evaluation harness on the example questions with per-category metrics.
- Marketing/landing page (see §11).

### 3.2 Stretch (only after MVP works end to end)

- DWG/DXF ingestion (ezdxf) and IFC ingestion (IfcOpenShell).
- **3D canvas for IFC models** (browser IFC viewer); click an element in 3D ↔ highlight its tag on the 2D sheet.
- Orbit / isometric / 360° camera presets in the 3D view (a camera setting, not a separate feature).
- **User markup on the canvas:** draw a region or drop a pin, then ask about it ("how many tiles here?").
- Conflict finder (schedule vs plan tags, dimension mismatches between sheets).
- Revision diff between two versions of a sheet.
- Live ingestion of newly uploaded files via Queues + Containers.
- Rough 3D massing extruded from clean 2D vector plans — **always labelled "preview, not measured"**.

### 3.3 Out of scope (do not build for the hackathon)

- Tinkercad-style editing (adding/placing objects and rendering them in 3D). It's a different product (a design
  tool) and doesn't help answer questions about existing drawings. Roadmap slide only.
- Animations.
- Photorealistic rendering.
- Training large custom models. (A small symbol detector is acceptable as a stretch; legend template matching first.)

---

## 4. Features and acceptance criteria

### F1 — Upload and ingest

- Accepts PDF (vector and scanned), and as stretch DWG/DXF and IFC.
- Each file gets a content hash; re-uploading the same file never reprocesses it.
- Ingestion is resumable and per-file fault tolerant: one broken file is logged and skipped, never stops the run.
- Produces: page renders + high-DPI tiles (R2), index rows (Postgres), ingestion report (pages, failures, timings).

### F2 — Sheet understanding

For every sheet, extract with provenance (sheet + bbox + source):
- **Title block:** sheet number, title, discipline, scale, revision, date.
- **Text items:** every string with coordinates (vector text first, OCR for scans).
- **Tables/schedules:** door, window, finish, rebar, etc. → structured rows.
- **Legend:** symbol → meaning (symbol crops kept as templates).
- **Grid:** grid line labels and geometry → a coordinate system ("grid C/4").
- **Cross-references:** callouts like `3/A-501` → links between sheets.
- **Rooms:** room tags, numbers, names, and boundary polygons where derivable.
- **Scale:** from title block or scale bar; cross-checked against dimension strings, mismatch flagged.

### F3 — Ask a question

- Plain-language questions in any language present in the dataset.
- Answer in the user's language; quote drawing text in its original language.
- Response streams progress (e.g. "Searching schedules… Reading A-601…").
- Acceptance: on the eval set, each answer either cites ≥1 valid source or explicitly abstains.

### F4 — Evidence and verification

- Every claim renders as a citation chip, e.g. `A-601 · Door schedule` or `A-201 · Grid C/4`.
- Clicking a chip zooms the canvas to the bbox with a highlight.
- Answers that fail verification are dropped or shown as "unverified" (see §7).
- Conflicts are shown with both sources.

### F5 — Quantities and counts

Examples: "How many tiles do I need for the bathroom on level 2?", "How many windows on the north façade?",
"What's the area of room 2.15?"
- Area from the room polygon × scale, or from stated dimensions — the canvas outlines the polygon used.
- Counts from schedule rows and/or detected symbols — each counted item is marked on the canvas; schedule count
  and plan count are compared and any difference is reported.
- Tile/material quantities show: area, tile size (asked or stated), waste factor (default 10%, stated as an
  assumption and editable), formula, result rounded up. Assumptions are always listed.
- Arithmetic is done in code (tool or code execution), never in the model's head.

### F6 — Workspace (two panes)

- **Left: chat.** Message list, input, attached-file chips, streaming answers with citation chips.
- **Right: canvas.** 2D sheet viewer (pan, zoom, sheet switcher, highlight overlays, tiles loaded on zoom).
  Stretch: 3D IFC view toggle, linked selection with 2D, user markup tools.
- Panes resizable; on narrow screens the canvas becomes a tab.

### F7 — Evaluation

- `evals/cases.json`: question, expected answer, expected sheet + bbox, category, language.
- Metrics per category: answer accuracy, citation accuracy (right sheet; bbox IoU ≥ 0.3), abstain rate,
  wrong-but-confident rate, latency, cost per question.
- Runs from one command; results saved per run so changes can be compared.

---

## 5. Architecture

```
            ┌──────────── Storage ────────────┐
 rclone ──► │ R2: originals, page renders,     │◄── evidence crop URLs
            │ high-DPI tiles                   │
            │ Cloudinary: crops/delivery (opt) │
            └──────────────────────────────────┘
                 │ enqueue per file / per page
                 ▼
       Cloudflare Queue ──► Container (Python ingestion)
                              ├─ PyMuPDF / OCR / ezdxf / IfcOpenShell
                              ├─ Gemini Flash for hard pages (batch where possible)
                              └─ writes index ─┐
                                               ▼
                    Aiven PostgreSQL (+ PostGIS + pgvector) ◄── Hyperdrive
                                               ▲
 Browser (chat + canvas) ──► Cloudflare Worker (TypeScript API + agent loop)
                                   └─ Gemini Pro via AI Gateway (tools + answer + verifier)
```

### 5.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Preact + @preact/signals + three.js, built with Vite (`@cloudflare/vite-plugin`), served by Workers static assets | Chat + canvas; 2D plan in SVG; isometric 3D in three.js, lazy-loaded |
| API / agent | Cloudflare Worker, TypeScript, Hono | Paid Workers plan available. Waiting on model calls doesn't count as CPU time |
| App data | Cloudflare D1 | Users, sessions, projects, files, plans, chat, model cache. The drawing index (PostGIS/pgvector) stays in Postgres |
| Ingestion | Python in Cloudflare Containers (fed by Queues), or a laptop script | Native libs don't run in Workers |
| Files | Cloudflare R2 (private bucket) | Upload with rclone/S3 API, not through a Worker |
| Images / crops | Pre-rendered pages + tiles in R2; crops via Cloudflare Images or Cloudinary | Cloudinary can render PDF pages (`pg_N`, `dn_DPI`, `c_crop`); **VERIFY** plan size limits |
| Database | Aiven PostgreSQL with PostGIS + pgvector | **VERIFY** extensions and storage on the chosen plan |
| DB access | Cloudflare Hyperdrive | TLS with Aiven CA; Workers have no fixed egress IPs |
| AI | Google Gemini (Flash for bulk extraction, Pro for agent + verifier) via Cloudflare AI Gateway | Function calling, JSON-schema output, image input, bounding boxes, embeddings. Check current model IDs |
| Optional | OpenSearch (Aiven) for multilingual full-text; Valkey (Aiven) cache; Vectorize if vectors outgrow Postgres | Only if needed |

### 5.2 Coordinate systems (common bug source — follow exactly)

- **Canonical:** PDF points, origin top-left, per page. All bboxes in the database are stored in points.
- **Pixels:** `px = pt × dpi / 72`. Every stored render/tile records its DPI.
- **Gemini boxes:** `[ymin, xmin, ymax, xmax]` normalized 0–1000 → convert to points using page size.
  Where an exact vector text box exists, snap to it; a model box alone is lower confidence.
- **Real-world units:** points → paper mm → model units via sheet/viewport scale. Record which scale was used.
- **Grid references:** derived from grid line geometry; stored as labels on items for display.

---

## 5.3 Auth (built)

- Email + password. PBKDF2-SHA256, 100k iterations (Workers maximum), 16-byte salt, constant-time compare.
- Session: 32 random bytes in an `HttpOnly; Secure; SameSite=Lax` `__Host-` cookie; only its SHA-256 is stored (D1 `sessions`), 7-day expiry.
- CSRF: SameSite=Lax plus an Origin check on every non-GET API request.
- Brute force: 8 failures per (email, IP), 30 per IP, or 100 per email across all IPs in 15 minutes → 429, so knowing an email is not enough to lock its owner out. Login doesn't reveal whether an email exists (sign-up does; accepted).
- Sign-up: at most 5 accounts per IP per hour. Expired sessions are purged on each sign-in.
- Quotas: one drawing being read at a time per user; re-uploading a file reuses its earlier reading; 200 questions per user per day.
- Answers: the verifier counts only numeric tool results, the question and the plan's own (code-written) assumptions as evidence. Drawing text (room names, labels) and the model's own assumptions never verify a number, and "N doors" must equal the counted value.
- Uploaded files are served with `CSP: sandbox` and, unless images, as attachments. User-facing errors never carry library or configuration details.
- Ingest container: runs as a non-root user; each parse runs in a child process with memory (3 GiB), CPU (90 s) and wall-clock (120 s) limits, one at a time per instance, with caps on DXF entities (200k) and points (2M), MINSERT arrays, PDF drawing items (200k) and text spans (20k), and image pixels (50 MP).
- Headers: CSP, HSTS, frame-ancestors none, nosniff (`apps/web/public/_headers`).
- Sign-up switch: `ALLOW_SIGNUP` var. Recommended for the public demo: Turnstile on the login form and/or Cloudflare Access in front.
- Known, accepted for the hackathon: PBKDF2 at the Workers cap (100k, below OWASP's 600k; Argon2id via WASM later); preview URLs (`preview_urls: true`) share production D1/R2, so protect `*.workers.dev` previews with Cloudflare Access or give them their own bindings before real users arrive; no password reset or "sign out everywhere" yet.

## 5.4 Plan extraction and the 2D/3D canvas (built, preview)

- Upload PDF/DXF/PNG/JPG/WebP (≤ 50 MB) → R2, deduplicated by SHA-256 per project.
- Gemini reads the drawing with a JSON schema: rooms (label as written, type, polygon), walls, doors/windows, and one
  dimension string with its endpoints. Points are `[y, x]` normalised 0–1000 (Gemini's native convention).
- Code does the measuring: scale = dimension value ÷ pixel length of that dimension line; fallback 0.9 m median door
  width; last resort "12 m across", each fallback recorded in `assumptions`. Areas are computed in code (shoelace).
- Stored `Plan` JSON (`apps/shared/plan.ts`): metres, origin top-left, y down. Always `measured: false` for AI
  extraction, so the UI shows "Preview, not measured". Response cached in `model_cache` by file hash.
- Canvas: 2D (SVG) / 3D (three.js, true isometric orthographic camera, 90° rotation steps, cutaway walls at 1.2 m by
  default) / split. In 2D a minimisable 3D inset; in 3D a 2D inset at the bottom. Hover and selection are linked across
  views and chat citations; rooms are coloured by type. Image sources can be overlaid under the 2D plan to check it.
- Chat agent: Gemini function calling over plan tools (`plan_info`, `list_rooms`, `get_room`, `count`, `calculate`,
  `final_answer`). Verifier: every number in the answer must appear in a tool result, the question, or a listed
  assumption; cited rooms must exist; otherwise the answer is shown as "Unverified".

## 5.4.1 Plan scale (built)

- 2D view shows the screen scale as `1:x` (editable; standard scales in a list; "Drawing 1:N" jumps to the drawing's own
  scale when known) and a graphic scale bar that is always correct relative to the plan.
- On-screen 1:x is nominal (assumes 96 CSS px per inch; real screens differ). **Print…** is exact: the SVG is sized
  in millimetres at 1:x on the smallest ISO sheet (A4–A0) that fits, with scale bar and a title line stating the scale
  and whether the plan is measured or a preview.
- `Plan.scale.ratio` stores the drawing's stated scale (vector PDF `1:N`).

## 5.4.2 Fittings, furniture and rendering (built)

- `Plan.fixtures`: WC, sink, bathtub, shower, sauna stove, cooker, fridge, washer, bed, sofa, table, desk, wardrobe.
  Read from the drawing as boxes by the model (prompt `read-v4`); code turns each to back onto its nearest wall
  (`placeFixture`) and assigns its room. Never invented; the sample house has hand-placed items.
- The agent's `count` tool counts fixture kinds with ids (the dataset's questions are mostly such counts).
- 2D: plan symbols per kind, overall dimension lines, haloed labels. 3D: architectural cutaway convention (dark cut
  wall tops), soft shadows, door leaves, window glass, fixtures as CC0 Kenney Furniture Kit models (`apps/web/public/models/kenney`,
  scaled to the size read from the drawing, clipped at the wall height; boxes for kinds without a model), room labels.
- Walls (`apps/shared/walls.ts`): mitered footprints (node-based corner intersection, T-junction splitting) drawn
  fill-only in 2D and extruded in 3D after cutting at opening edges; outline from shared-edge cancellation; baked
  occlusion (wall-base gradient, floor contact strips skipping doorways); door/window frames and sills; room labels
  at the pole of inaccessibility. Techniques after neonplan3d (MIT, © 2026 Mastershort), reimplemented.
- 3D wall modes: **Dollhouse** (default; exterior walls whose indoor side faces away from the camera drop to 0.3 m,
  back walls stay full height with windows, partitions cut at 1.2 m; recomputed on rotation), **Cut 1.2 m**, **Full**.
- Floor materials: procedural canvas textures (wood planks, 300 mm tiles, concrete, decking; 1 texture = 1 m²) chosen by
  room type and tinted by the room colour; matching light patterns in 2D. A visual convention, not drawing data.
- VespeneLabs/floor-view was reviewed: its code is UNLICENSED (private), so only its CC0 Kenney assets were reused.

## 5.4.3 Rooms, areas, heights, doors and feng shui (built)

- `apps/shared/rooms.ts`: per room net area, perimeter, length × width (minimum bounding rectangle), ceiling height,
  volume, doors/windows, glazed area (sill 0.9 m to head 2.1 m where not drawn) and glazing ratio. Plan: **net** floor
  area (rooms to the inside of walls), wall area, **gross** = net + walls (DIN 277 NRF/BGF style), net/gross, volume.
- Heights: `Plan.levels` {floor (FFL), ceiling}. The model copies level marks and ceiling notes as written
  (FFL/OKFF/NGF, RH/lichte Höhe/HSP/CH); code parses them. Unstated values are shown as "not stated" / "assumed".
- Doors: `Opening.swing` + hinge at `a`. `orientDoors` applies the usual rules (into rooms rather than corridors, out of
  cupboards, entrance inward, otherwise into the more private room; hinge at the end nearer a corner; avoid furniture).
  Check: a door whose leaf sweep hits furniture.
- Feng shui (`apps/shared/fengshui.ts`), presented as traditional guidance: command position (door not straight in
  front of the foot of the bed / WC / behind the cook), headboard not under a window or against a bathroom, desk user
  not with their back to the door, sofa backed by a wall facing the room entrance, stove not beside the sink, light,
  doors not blocked, entrance not lined up with an opening across the home. "Apply feng shui furniture" places
  suggested items in empty rooms by the same rules (`source: 'suggested'`, dashed in 2D, never treated as drawing
  data). "Ask AI for an overview" sends the room/plan to the agent (tools `room_info`, `plan_areas`, `feng_shui`).
- `placeFixture` backs an item onto the wall nearest its **edge**, so long items (beds) back onto their short end.

## 5.4.4 Teams, revisions and pinned comments (built)

- Teams: an owner adds existing accounts by email; members open, upload, ask, comment and label revisions in the team's projects; owners delete and move projects. Deleting a team returns its projects to their creators. Contract: `docs/API.md`.
- Revisions: each plan row is a revision (r1 = oldest). Comparing two (`apps/shared/diff.ts`) matches rooms by name and type, then by overlap, and walls by centre line within 10 cm; it reports rooms added, removed and resized, walls added and removed, doors, windows, and net and gross area.
- Comments are pinned in plan metres to one revision and threaded. "Ask bimp" answers in the thread with the drawing sheet (the source render, the pin's position given on it), the room and openings and fittings within 1.5 m, and the plan tools; the same verifier marks the answer verified or not. Questions in comments count toward the daily cap.

## 5.5 Ingestion: Workflows + Containers (built)

- Two Workers: `bimp` (site, app, API; gets preview URLs) and `bimp-ingest` (Workflow + Container). Split because
  Cloudflare generates no version/preview URLs for Workers that contain Durable Objects, and Containers are Durable Objects.
- Upload → R2 → `jobs` row → Workflow instance (same id). Steps, each retried on its own, big results kept in R2:
  1. **analyze** (Container, `ingest/service.py`): PDF → render ≤ 3000 px + vector line segments + text spans with
     boxes + sheet scale from `1:N` text (most frequent; others listed). Scans/images → render + OpenCV wall strokes
     (Otsu, morphological opening, Hough). DXF → INSERTs expanded, curves flattened, rendered; scale exact from `$INSUNITS`.
  2. **read** (Gemini, cached by render hash): room labels/types/outlines, openings, one dimension string.
  3. **measure + save** (code): room outlines snapped **edge by edge** to the drawing's line work (parallel, overlapping
     line within 1 % of the sheet; corners = intersections); labels replaced by the exact text inside the room when it
     matches; scale = stated on the drawing > dimension string > door width > assumed; stated scale cross-checked
     against the dimension, mismatch > 5 % reported as a conflict.
- **Measured** only when the scale is stated exactly (vector sheet `1:N` or DXF units) AND ≥ 90 % of corners snapped,
  for vector PDF or DXF. Everything else stays "Preview, not measured".
- Formats: PDF (vector, scanned; page 1), PNG/JPG/WebP, DXF. DWG is rejected with "export to DXF".
- Checked on generated fixtures with ±0.4 % position noise on the model output: vector PDF at 1:100 → all 8 areas
  exact, measured; 150 dpi scan → within ~2–4 %, preview.

## 5.6 Design knowledge (built) — Metric Handbook, 4th ed. (Littlefield, 2012)

Reference book supplied by the team (all parts: Ch. 1–42 and appendices). Figures are encoded as facts with citations in
`apps/shared/standards.ts`; the book's text is not copied into the product.

| Source | Used for |
|---|---|
| Ch. 1 Table III preferred scales; plans at 1:50 / 1:100 / 1:200 | Scale from a dimension is rounded to the nearest preferred scale when the paper size is known (PDF page, image DPI); non-preferred stated scales are flagged |
| Ch. 1 §2 notation: mm without decimals or m; decimal comma; no thousands marker | `parseDimension` — code, not the model, converts dimension text to metres |
| Ch. 1 drawing conventions (levels FFL/SSL/TBM, grid lines, dashed = overhead) | Reading prompt: levels and grids are not dimensions or walls; title-block scale is read as `stated_scale` |
| Ch. 1 §3.2 inclined lines at multiples of 15° | `regularize`: preview and raster outlines straightened to the room's axes |
| Ch. 2 §4.6, §4.9 doorsets 800/900/1000 mm | Door-width scale fallback (0.9 m) and a check that flags implausible door widths as a likely scale error |
| Ch. 2 Fig. 2.35 corridor widths; §4.5 wheelchair turning 1.4 m; §5.2 / Table X stairs | Corridor check; `space_standard` tool |
| Ch. 8 Table IV room minimums; Table III bed sizes; net area to inside wall faces | Room-size checks; bedroom width check; `space_standard` tool; outlines follow inside faces |
| Ch. 41 Figs. 41.16–41.21 (flat: 9 m to the entrance door without an alternative exit); Table XV travel distances; Tables XI, XIV occupancy and escape widths | `apps/shared/escape.ts`: door graph, exits = doors with open air on one side, worst-point travel distance per room; 2D **Escape** overlay; check; `escape_route` and `occupancy` tools |
| Ch. 42 §5.2 stairs ≥ 1000 mm between handrails, ≤ 12 steps a flight, ramps ≤ 1:12; Tables V–VI wheelchair turning | Stair-width check; `space_standard` (access) |
| Ch. 37 §4 bricks 215 × 102.5 × 65, blocks 90–100 mm | `wallsFromFaces`: facing room edges 75–600 mm apart become one wall of the measured thickness on their centreline; edges closer than that (or overlapping by a raster stroke) are the same wall; unpaired edges get a wall outside the room so areas stay net |
| Ch. 31 Fig. 31.30 smallest single garage 2400 × 4900 mm | Garage check |
| Ch. 39 daylight | Habitable rooms with no window (only when ≥ 2 windows were found, to avoid noise from incomplete readings) |

- Scale order for non-vector sources: sheet `1:N` read by the model and confirmed by a dimension (≤ 5 %) > dimension
  rounded to a preferred scale (paper size known) > raw dimension > stated scale alone > door width > assumed.
  Disagreements are reported as conflicts.
- Checks (`checkPlan`) are shown in the canvas ("Checks" in the legend bar) and available to the agent (`check_plan`).
  They are plausibility flags that point at misreadings, not compliance verdicts.
- Fixture results (`npm test` for the rules; ingestion with ±0.4 % model noise): vector PDF exact and measured; scanned
  PDF and PNG with DPI now get the exact 1:100 scale, remaining area differences ≤ ~4 % are outline position on raster
  strokes (inside-face net area vs the fixture's centreline areas).

## 6. Data model (PostgreSQL)

```sql
documents   (id, project, filename, format, content_hash UNIQUE, r2_key, status, created_at)
sheets      (id, document_id, page, sheet_no, title, discipline, scale, revision, lang,
             width_pt, height_pt, render_r2_key, render_dpi)
text_items  (id, sheet_id, text, text_norm, lang, bbox geometry, source)        -- source: vector|ocr|gemini
tables      (id, sheet_id, kind, bbox geometry, header jsonb, rows jsonb)       -- each row keeps its own bbox
legend      (id, sheet_id, symbol_bbox geometry, meaning, template_r2_key)
symbols     (id, sheet_id, kind, bbox geometry, confidence, method)             -- method: template|detector|gemini
grid_lines  (id, sheet_id, label, line geometry, axis)
rooms       (id, sheet_id, number, name, polygon geometry, area_m2, source)
xrefs       (id, from_sheet_id, bbox geometry, target_sheet_no, target_detail, target_sheet_id)
ifc_elements(id, document_id, guid, ifc_type, storey, name, props jsonb, quantities jsonb)
chunks      (id, sheet_id, text, embedding halfvec(768), bbox geometry)          -- notes, table rows, title blocks
jobs        (id, document_id, page, stage, status, attempts, error, updated_at)  -- resumable ingestion
gemini_cache(key PRIMARY KEY, model, request_hash, response jsonb, created_at)    -- never pay twice
```

Embed chunks, not every text item; exact codes (e.g. `T1.04`, `EI30`) use full-text / trigram search.

---

## 7. Answering pipeline

1. **Route** the question by type: lookup, schedule, cross-sheet, count, measure/quantity, location, BIM, consistency.
2. **Agent loop** (Gemini Pro, function calling). Tools:

| Tool | Does |
|---|---|
| `search_text(query, filters)` | Full-text + vector search over text items and chunks |
| `query_table(kind, match)` | Look up schedule rows |
| `count_symbols(kind, region?)` | PostGIS count of symbols, optionally inside a room/region |
| `measure(target)` | Area/length from geometry × scale, or from dimension text |
| `follow_xref(ref)` | Resolve `3/A-501` to the target sheet/region |
| `grid_lookup(sheet, grid)` | What's at grid C/4 |
| `query_ifc(filter)` | Elements, properties, quantities from IFC |
| `view_region(sheet, bbox, dpi)` | High-DPI crop for the model to read |
| `calculate(expression, inputs)` | Arithmetic in code |

3. **Answer contract** (JSON schema, enforced):

```json
{
  "answer": "EI30",
  "claims": [
    { "text": "Door T1.04 has fire rating EI30",
      "sheet_id": 42, "bbox": [x0, y0, x1, y1], "source_type": "table_row", "source_id": 991 }
  ],
  "calculation": null,
  "assumptions": [],
  "conflicts": [],
  "confidence": "high",
  "not_found": false
}
```

4. **Verify** each claim:
   - Re-crop the cited region at high DPI; ask the model (separate call) "Does this image support: <claim>? yes/no".
   - Every number in the answer must appear in the cited sources or be produced by `calculate`.
   - Failed claims are removed; if nothing remains, return `not_found` with what was searched.
5. **Render**: answer text, citation chips, calculation block, assumptions, conflicts; canvas jumps to the first citation.

---

## 8. Multilingual

- Detect drawing language per sheet; store `lang` on text items.
- Abbreviation glossary per language (e.g. German OKFF, OK RD, UK, FBH; French NGF, HSP), expanded into `text_norm`.
- Normalize numbers and units (`2,50` vs `2.50`, mm vs m, feet-inches).
- Translate the question into the drawing's language for search; use multilingual embeddings.
- Answer in the user's language; quote source text verbatim in its own language.

---

## 9. Ingestion at scale (10 GB)

- Measure on the preview: pages per GB, % vector vs scanned, Gemini tokens per page, seconds per page, index size.
  Extrapolate ×20 before the full run.
- Use exact extraction first; Gemini only for scanned pages, title-block/legend interpretation and hard tables.
  Prefer Gemini's batch mode for bulk work if available for the chosen model. Cache every model result.
- One Queue message per file (per page for very large PDFs). Render one page at a time to bound memory.
- Cap concurrency to stay within Aiven connection limits and Gemini rate limits.
- Run the full ingestion the night before judging; keep the ingestion report for the pitch.

---

## 10. Limits and checks (VERIFY before relying on them)

- Workers: per-isolate memory (~128 MB), CPU limits on the paid plan, request body cap — no file processing in Workers.
- Containers: instance memory sizes, cold start, availability status.
- R2: no Worker uploads for big files; per-file limits of `wrangler r2 object put`.
- Cloudinary: max upload size per file, credits for storage/transformations, max image megapixels
  (an A0 sheet at 200 DPI is ~60 MP).
- Cloudflare Images: input size limits for crop transformations.
- Aiven: plan storage (embeddings: 768-dim ≈ 3 KB each, half that with halfvec), connection limit, PostGIS/pgvector availability.
- Gemini: current model IDs, rate limits, regional availability from the Worker's location, batch support, cost.
- Data rights for the dataset; keep buckets private; demo behind a password if required.

---

## 11. Marketing page

Purpose: explain BIMP in one scroll and get people into the demo. Never show features that aren't built.

1. **Hero** — headline about the outcome ("Ask your drawings. See the answer on the sheet."), one supporting line,
   large shot of the two-pane workspace (question, answer with citation chip, canvas zoomed to the highlighted row).
   CTAs: "Try the demo", "See how it works".
2. **Problem strip** — engineers lose hours searching drawing sets; general AI guesses. Only cite numbers with a source.
3. **How it works** — upload → ask → answer with evidence.
4. **Example questions with proof** — door fire rating (schedule row), tiles for a bathroom (room outline + calculation),
   windows on a façade (counted and marked), which detail shows the parapet (callout followed).
5. **Workspace tour** — chat + canvas; 2D highlights; 3D IFC view linked to 2D (only if built).
6. **Why you can trust it** — every answer cites its source; exact measurements from geometry; conflicts flagged;
   quantities show their working.
7. **Formats and languages** supported.
8. **Results** — eval metrics per question type (accuracy, citation accuracy, time to answer).
9. **Who it's for** — site engineers, project managers, contractors.
10. **Final CTA + footer** — demo link, team, technology (Gemini, Cloudflare, Aiven, Cloudinary), contact.

Avoid: "100% accurate" claims, renders better than the real product, generic AI imagery.

---

## 12. Brand

- Name: **BIMP** — *BIM Pilot*. Tagline candidates: "Every answer, on the drawing.", "Answers you can point to.",
  "Your pilot through the drawing set."
- Tone: precise, calm, practical, plain words. Professional, not corporate; technical, not cold.
- Visual identity (2026-11-14, supplied by the team as CorelDRAW SVGs):
  - Full logo `apps/web/src/brand/logo.svg` (lowercase "bimp": the b drawn as a door swing, the i's dot as a target
    mark). Used in the app top bar, login, marketing header and footer. Accent orange **#FF6B2B** in the marks only.
  - Icon `apps/web/public/brand/favicon.svg` (the b on a #17191c rounded tile) + PNG 32/180/512 fallbacks.
  - Spinner `apps/web/src/brand/loading.svg` (target mark, rotates) for loading states.
  - Palette (2026-11-14): orange **#FF682B** (markers, rules, button fills; never text on paper: 2.56:1), off-white
    paper **#F4F1EA** (panels #EBE6DC, raised #FBFAF7), charcoal **#1E1D1B** (text 14.9:1), muted #6B665D (5.05:1),
    control borders #8F897D (3.08:1). Buttons: charcoal on orange (5.83:1). Dark mode swaps paper and ink.
  - Type: **Jost** (geometric, monoline like the logo; light weights for headings) and **IBM Plex Mono** for
    annotations, labels and figures. Self-hosted (@fontsource, OFL). Tokens in `apps/web/src/tokens.css`.
  - Visual language "the drawing sheet": hairline rules, sheet frames with crop marks and title blocks, survey-target
    annotations with leader lines, numbered sections. No gradients, glow, sparkles, robots or stock photography.
  - Marketing site: Home, Product, Method, About (`apps/web/{index,product,method,about}`), shared header/footer
    partials injected at build (`apps/web/partials`, Vite plugin in `vite.config.ts`). Product imagery is rendered
    from the real app (`apps/web/public/shots`).
  - Web versions: cropped to the artwork, print crop marks removed, white → currentColor so the marks follow the
    text colour (dark on light, light in dark mode), class names prefixed per file. UI accent stays #c2410c for text
    and buttons (better contrast on white than #FF6B2B).
- Previously: visual identity TBD — to be generated from a brand board. Constraints: no AI clichés (sparkles, glowing orbs,
  brains, robots, purple-blue gradients, neon, glassmorphism), no construction clichés (hard hats, cranes, stock
  photos), no all-blue blueprint look, no generic rounded startup aesthetic. Fonts must be real and available (e.g.
  Google Fonts). Once chosen, record palette (hex), fonts and logo rules here.

---

## 13. Repository layout (proposed)

```
/apps/web            frontend (chat + canvas) and marketing page
/apps/api            Cloudflare Worker: API, agent loop, tools, verifier
/ingest              Python ingestion (Dockerfile for Containers, CLI for local runs)
/db/migrations       SQL migrations (PostGIS, pgvector, tables above)
/evals               cases.json, runner, reports/ (gitignored)
/docs                this file and design notes
wrangler.toml        Worker, R2, Queues, Hyperdrive, AI Gateway, Containers bindings
```

## 14. Conventions for anyone (human or AI) working on this

- Read this file first. Keep it current: update it in the same change as any decision or feature change.
- Secrets only via `wrangler secret put` / environment variables. Never commit keys or connection strings.
- Every new answer path must return citations and pass the verifier; add eval cases for every new question type.
- Prefer deterministic code over model calls; every model call is cached and its cost logged.
- Bboxes in PDF points everywhere (see §5.2). Convert only at the edges.
- Make ingestion steps idempotent and resumable.
- Don't add out-of-scope features (§3.3) without updating this file first.
- When unsure about a limit or API, check the official docs; mark unverified assumptions with **VERIFY**.

## 15. Glossary

| Term | Meaning |
|---|---|
| Sheet | One drawing page, identified by a sheet number like `A-201` |
| Title block | The box on a sheet with its number, title, scale, revision, date |
| Schedule | A table on a drawing listing elements (doors, windows, finishes) and their properties |
| Grid | Lettered/numbered reference lines on a plan; locations like "C/4" |
| Callout / xref | A marker pointing to a detail on another sheet, e.g. `3/A-501` |
| Legend | Key explaining the symbols used on a sheet |
| Take-off | Measuring/counting quantities from drawings for estimating |
| IFC | Open BIM file format (Industry Foundation Classes) |
| BIM | Building Information Model — a 3D model with element data |
| Waste factor | Extra material added to a quantity for cuts and breakage (default here 10%) |
| bbox | Bounding box `[x0, y0, x1, y1]` in PDF points |

## 16. Open questions

- Exact format and language mix of the dataset; does it include IFC and DWG/DXF? (DWG: ask organizers for DXF/PDF exports.)
- Judging on full set or hidden set? Is live ingestion expected?
- Data storage permissions for each service.
- Which sponsor integrations are scored?
- Final brand identity.

## 17. Decision log

| Date | Decision |
|---|---|
| 2026-11-13 | Name BIMP (BIM Pilot); positioning "chat that answers, canvas that proves it" |
| 2026-11-13 | Stack: Cloudflare (Workers, R2, Queues, Containers, Hyperdrive, AI Gateway) + Aiven Postgres + Gemini (+ Cloudinary optional) |
| 2026-11-13 | Ingestion in Python outside Workers; index once, answer from the index |
| 2026-11-13 | Tinkercad-style editing and animations out of scope; 3D-from-2D only as labelled preview (stretch) |
| 2026-11-13 | App data (users, sessions, projects, plans, chat) in D1; drawing index stays in Aiven Postgres when built |
| 2026-11-13 | Frontend: Preact + signals + three.js via Vite; app at `/app/` with hash routing; three.js lazy-loaded |
| 2026-11-13 | Login: two halves, single conversational input (email → password) with `bimp.` wordmark left; our own isometric render under a blueprint-blue overlay right. Blueprint blue is used only here (user request overrides §12 for the login) |
| 2026-11-13 | Logo for now: lowercase wordmark `bimp.` |
| 2026-11-13 | Floor plan → 2D + isometric 3D via Gemini extraction, labelled preview; cutaway walls default in 3D |
| 2026-11-13 | Ingestion: Cloudflare Workflow + Python Container (PyMuPDF, OpenCV, ezdxf) in a separate `bimp-ingest` Worker so `bimp` keeps preview URLs |
| 2026-11-13 | "Measured" requires an exact stated scale and ≥ 90 % of corners snapped to vector line work |
| 2026-11-13 | Plan scale: nominal 1:x on screen + scale bar; exact 1:x only via print in mm |
| 2026-11-13 | Metric Handbook (4th ed.) adopted as the design-knowledge reference; rules encoded with citations in `apps/shared/standards.ts` |
| 2026-11-13 | Fire escape distances and wall thickness from facing room edges added from Metric Handbook Ch. 31–42 |
| 2026-11-13 | Fixtures read from drawings and rendered in 2D/3D; 3D uses the architectural cutaway convention |
| 2026-11-14 | Design system: #FF682B / #F4F1EA / #1E1D1B, Jost + IBM Plex Mono; multi-page marketing site; redesigned dashboard |
| 2026-11-14 | Teams and shared projects (owners and members); revisions (every reading of a drawing, numbered and labelled) with browser-side comparison (`diffPlans`); comments pinned to a spot on a revision, where bimp answers from the drawing sheet with the pin marked plus the plan tools. App layout: left sidebar, canvas, right panel with Chat / Comments / Revisions / Info. Visual system: one sans, no eyebrow labels, monospace only for numbers and ids. Marketing: Product, Pricing, Changelog, Docs, Sign in. API contract in `docs/API.md` |
| 2026-11-14 | Light theme only; drawing sheet white. 2D plan follows drafting convention: cut plane 1.2 m, poché by wall type (45° masonry hatch ≥ 250 mm, cross-hatch load-bearing 150–250, open partitions), ISO 128-2 line weights (0.70 / 0.50 / 0.32 / 0.35 / 0.25 / 0.16 mm, non-scaling), above-cut dashed. Plan and Dimensioned modes: Dimensioned adds facade, structure and overall strings on all sides, room clear sizes and door widths, in mm |
| 2026-11-14 | Review fixes (security, UI/UX, functionality): wall builder closes corners and pairs faces of any thickness; detail scales no longer win over the plan scale; scale/dimension conflicts make a plan a preview; escape distance sampled along edges and inside rooms; verifier hardened; per-user quotas; ingest parse limits; keyboard access to rooms, live chat regions, info panel docking |
| 2026-11-14 | Room/plan info panel (net/gross, heights), door swing rules, feng shui checks and suggested layout |
| 2026-11-14 | Dollhouse cutaway is the default 3D mode; procedural floor materials by room type |
| 2026-11-14 | Mitered wall footprints + baked occlusion (after neonplan3d, MIT); minimised inset views removed |
| 2026-11-14 | 3D fixtures use the CC0 Kenney Furniture Kit; VespeneLabs floor-view code not reused (UNLICENSED) |
| 2026-11-13 | Marketing page v1: plain static HTML + one CSS file in `apps/web/`, system fonts, no build step, default styling; focus stays on functionality. Results section is a placeholder until evals run. Demo CTA points to `/app` |
