# bimp: plan from here to judging

Ordered by what moves the judged score most. Each step has a test for "done". Keep this file current in the same
change as the work; decisions also go in the decision log in `docs/BIMP.md`.

## Where we are (2026-11-14, evening)
- **Live:** site and app (`bimp` Worker); ingestion Worker `bimp-ingest` **with its container image and the symbol
  detector** (`fixtures-v1`); Gemini key on both Workers; the dataset in `r2://bimp-files/dataset/`.
- **Tested live end to end:** a CubiCasa scan uploaded, read (detector + Gemini), and asked count questions in chat.
- **Measured (`npm run eval -- --sample 500`, dev split, code only, no language model):** 31.0 % of scored questions
  correct. Only five CubiCasa templates are answered so far: toilets 98 %, sinks 95 %, showers/baths 76 %, doors 76 %,
  windows 62 %. Everything else is unanswered and counts as wrong. The sample includes plans the detector was trained
  on, so these five are optimistic (72 % overall on its own test plans).
- **Not built:** Swiss vector reading, Finnish room-label rules, IFC, boxes on the source sheet, the agent in the eval.
- **Known problems:** the chat agent sometimes ends with "Agent did not finish" on count questions (2 of 7 live);
  a slow Gemini read used to be cut at about 125 s (now streamed).

## How we will be judged (from the dataset README)
127,044 questions over ~5,900 drawings. **Counts must be exact; areas, lengths and volumes within 2 %.**

| Source | Share | Format | What's asked |
|---|---|---|---|
| cubicasa5k | 67 % | PNG scans (Finnish) | Counts: windows, doors, WCs, sinks, showers/baths, saunas, kitchens, bedrooms, bathrooms, balconies, floors |
| swiss_dwellings | 30 % | Vector PDF (+ DXF, PNG) | Room counts by label, apartments, fittings, net floor area |
| ifc_models / ifc_bench | 3 % | IFC + rendered PDFs | Areas, volumes, space lists |
| opening_design | < 0.1 % | Real drawing sets | Schedule and sheet questions |

About 30 question templates (each in English and Finnish) cover most of it. **Route by template, answer with code.**

---

## Phase 0: switch on what is built (½ day)
1. Set `GEMINI_API_KEY` on both Workers; create an **AI Gateway** and set `AI_GATEWAY_URL` (caching, logs, cost).
2. Build the container image: connect the repo in **Workers Builds** for `bimp-ingest` (settings in the README).
3. Upload one drawing of each format in the live app; fix whatever breaks first.
4. Set `ALLOW_SIGNUP` to `"false"` once the team has accounts; put Cloudflare Access on preview URLs.

**Done when:** a vector PDF, a scan and a DXF each become a plan on the live site, and chat answers about them with citations.

## Phase 1: eval harness first (1 day)
0. **Built:** `evals/eval.ts` (split by drawing, stratified sample, official scoring, tables by source × type and by
   template, reports in `evals/reports/`) and the question router `apps/shared/templates.ts`. Still to do below: the
   agent as an answerer, latency and cost, comparison with the previous run.
1. `evals/split.ts`: split `questions.jsonl` **by drawing** into dev (80 %) and held-out (20 %), stratified by source and type.
2. `evals/run.ts`: for each question, ingest its drawing (cached), ask, and score with the official rules (exact counts,
   ±2 % measures, text by review). Per run, record answer, citations, latency and model cost.
3. `evals/report.ts`: accuracy by type × source, abstain rate, wrong-but-confident rate, cost per question,
   compared with the previous run.
4. Run a **500-question stratified sample** first; publish nothing until the held-out set is scored.

**Done when:** `npm run eval -- --sample 500` prints the table, and a second run on the same code gives the same numbers.

## Phase 2: answer by template, with code (3–4 days, biggest gain)
Build a **question router**: match the ~30 templates (both languages) to deterministic tools. The chat agent stays
for everything else.

**2a. CubiCasa: counts on scans (67 %)**
- Check whether the dataset ships the CubiCasa **SVG annotations** next to the PNGs (same file name, other extension).
  - If yes: ground-truth room polygons and symbol positions → exact counts with no model at all for those drawings,
    and a labelled training set for the rest.
  - If no: train a small **symbol detector** (YOLO-class, ~10 classes: window, door, WC, sink, shower, bath, sauna
    stove, stove, balcony rail) on a rented GPU or Colab; run it on CPU in the container via ONNX. Every detection is
    a box on the canvas, so counts are checkable.
- **Room counts from Finnish labels** in code: MH (bedroom), KH/KPH/PH/PESUH (bath/wash), WC, S (sauna), K/KK/KEITTIÖ (kitchen), PARV (balcony).
- **Done when:** CubiCasa counts reach ≥ 90 % exact on dev, with no category below 80 %.

**2b. Swiss dwellings: exact from vectors (30 %)**
- Read room labels and outlines straight from the vector PDF or DXF (no model): counts by label ("Zimmer", "Réduit", …),
  apartments, fittings and net area of numbered rooms.
- **Done when:** ≥ 95 % exact counts and ≥ 95 % of areas within 2 % on dev.

**2c. IFC (3 %)**
- IfcOpenShell in the container: spaces, storeys, quantities (net/gross side area, volume), element counts.
- Answer the `ifc_models` PDFs from their source `.ifc` (same name).
- Show the real model in the 3D view (ThatOpen / web-ifc, MIT), linked to the 2D plan.
- **Done when:** ≥ 90 % of IFC numeric questions within tolerance on dev.

**2d. Everything else:** agent plus verifier, unchanged. Tune prompts only against the dev split.

## Phase 3: ingest the whole dataset (1 day, runs overnight)
1. `POST /api/admin/import { prefix }`: one Workflow per file straight from R2 (no browser upload); group files by
   `data/<source>/` into projects; skip duplicates by hash.
2. DWG → DXF in the container (LibreDWG); multi-page PDFs page by page.
3. Throttle to Gemini and container limits; keep an ingestion report (pages, failures, time, cost).
4. Measure on 200 files first and extrapolate ×70 before the full run.

**Done when:** ≥ 98 % of files ingested; failures listed with reasons; the cost is known.

## Phase 4: product polish that judges will see (2 days)
1. **Answers on the source sheet:** a citation opens the original drawing zoomed to the box it came from (not only the rebuilt plan).
2. **Streaming answers** with progress ("Reading A-601…").
3. **Multi-storey:** pages to levels; 3D stacks floors at their heights; stairs.
4. **Corrections:** change a room type, move a door, keep suggested furniture; corrections go in the eval notes.
5. **Licence credits:** show the credit from `data/<source>/LICENSE.md` wherever a drawing is displayed (CC BY, BY-SA).

## Phase 5: pitch (1 day)
1. Replace "results will be published" with the **held-out numbers**, by type and source, with the date and sample size.
2. A 3-minute demo script: upload → ask a count → click the citation → see the boxes → ask an area → see the calculation.
3. Run `/security-review` and `/code-review` on the full diff; fix findings.
4. Freeze `main` the evening before; tag the release.

---

## Risks and decisions to make now
| Risk | Mitigation |
|---|---|
| Gemini cost on 14k drawings | Deterministic paths first (2a–2c); cache by content hash; measure on 200 first |
| CubiCasa licence is NonCommercial | Fine for the challenge; a detector trained on it can't ship commercially as is |
| Container image never built | Workers Builds (Phase 0.2) is the only path without local Docker |
| Overfitting to dev | Score only once on held-out; report both |
| Time | Phases 0–2 are the score; 3–5 can shrink |

**Open questions for the team:** the judging deadline; whether judging uses this dataset or a hidden one; who owns each phase.
