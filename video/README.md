# Demo video

`bimp-demo.mp4` (76 s, 1080p) is a recording of the live app, with title cards, captions and camera moves added.

- `record.js` drives the app with Playwright and saves a screenshot for every mouse step, keystroke and wait
  (`take/frames.json` plus JPEG frames). It needs a signed-in `state.json` and uploads `plan-with-piano.webp`:
  the Swiss plan with a grand piano drawn in, so the reading has a symbol bimp cannot name. Note that the app shows
  the upload under the file's own name.
- `film.html` assembles the film from a take; waits for the model are shortened (see `SQUEEZE`). It expects
  `logo.svg` and the Jost / IBM Plex Mono font files beside it.
- `render.js <take>` writes the 30 fps frames; `music.py <seconds> <lift1> <lift2> <outro>` synthesizes the soundtrack.
