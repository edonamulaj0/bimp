# bimp promo video

`bimp-promo.mp4` is a 73-second, 1920 × 1080, 30 fps promo. It is an HTML animation rendered frame by frame, so every
frame can be changed in code.

| File | What |
|---|---|
| `index.html` | The whole animation: scenes, copy and timeline. `render(t)` draws the frame at `t` seconds. |
| `render.mjs` | Steps through the frames with Playwright and pipes them to ffmpeg. |
| `audio.py` | Synthesises the soundtrack with numpy (no samples). 96 bpm; scene cuts sit on beats. |
| `wordmark-entry.ts` → `wordmark.js` | The app's own wordmark animation (`apps/web/src/brand/wordmark.ts`), bundled for the page. |
| `assets/` | Workspace screenshots captured from the live app (pilot house, with a real bimp AI answer). |

It also reads the fonts from `node_modules` and the self-drawing plan from `apps/web/partials/plan-drawing.html`.

## Rebuild

Run from the repo root, after `npm install`. Needs Playwright with Chromium, ffmpeg, and Python with numpy.

```bash
npx esbuild promo/wordmark-entry.ts --bundle --format=iife --outfile=promo/wordmark.js
```

```bash
node promo/render.mjs
```

```bash
python3 promo/audio.py
```

```bash
ffmpeg -y -i promo/out/video.mp4 -i promo/out/audio.wav -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart promo/bimp-promo.mp4
```

To check single frames while editing: `node promo/render.mjs --stills 12.5,31` writes PNGs to `promo/out/stills/`.
To watch it in a browser, serve the repo root and open `/promo/index.html?play`.

If scene times change, move the matching cues in `audio.py`.
