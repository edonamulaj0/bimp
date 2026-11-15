# bimp API (v2: teams, revisions, pinned comments)

All routes under `/api`, JSON, session cookie, same-origin check on non-GET. Errors: `{ error }` with a status.

## Access
A project is reachable by its owner (`projects.user_id`) and by every member of its team (`projects.team_id`).
`role` on a project is `owner` (created it, or owns its team) or `member`. Only an owner deletes a project or moves it
between teams. Anyone with access can upload, ask, comment and label revisions.

## Me
`GET /me` → `{ user: {id, email, demo?}, ai: boolean, teams: [{ id, name, role: 'owner'|'member' }] }`. Also makes sure the account has the
current pilot house, once per version of the house: an untouched sample project gets it as a new revision, an account without one gets a new
"Pilot house" project.
`POST /auth/demo` → `{ user, project_id }`. A throwaway account with the pilot house, signed in for a day (off with `ALLOW_DEMO=false`). A demo can do
what any account can. `DELETE /me` needs no password for it. Demo accounts are deleted after two days, with their projects and files.
`DELETE /me { password }` → `{ ok }`. Closes the account after the password is given again (403 if wrong). Personal projects are deleted with their files and images; projects created in a team that has another owner pass to that owner. 409 if the caller is the only owner of a team that has other members.

## Teams
- `GET /teams` → `{ teams: [{ id, name, role, members: number, projects: number }] }`
- `POST /teams { name }` → `{ team }` (creator is owner)
- `GET /teams/:id` → `{ team: {id, name, role}, members: [{ user_id, email, role }] }`
- `POST /teams/:id/members { email }` (owner) → `{ member }`. 404 if no account has that email.
- `DELETE /teams/:id/members/:uid` (owner, or yourself to leave; the last owner can't leave)
- `DELETE /teams/:id` (owner). Its projects return to their creators.

## Projects
- `GET /projects` → `{ projects: [{ id, name, updated_at, files, has_plan, thumb, role, team: {id, name} | null, revisions: number, comments: number }] }`
  (yours and your teams'). Optional `?team=<id>` or `?team=personal`.
- `POST /projects { name, team_id? }` → `{ project }`
- `PATCH /projects/:id { name?, team_id? }` (`team_id` owner only; `null` = personal)
- `DELETE /projects/:id` (owner)
- `GET /projects/:id` → `{ project: {id, name, created_at, updated_at, role, team}, plan, plan_id, revisions, files, jobs, messages }`
- `GET /projects/:id/files/:fid/preview` → the uploaded drawing as an image: the file itself for PNG/JPG/WebP, the sheet as rendered for reading for PDF/DXF (404 until it has been read)
  - `revisions`: newest first, `[{ id, rev, file_id, filename, note, created_at, rooms, net_m2, measured }]` (`rev` counts from 1, oldest first)
  - `messages[]`: `{ id, role, content, created_at, user_email }` (`user_email` on user messages in shared projects)

## Revisions
Every reading of a drawing is a revision (a row in `plans`). The latest is the project's plan.
- `GET /projects/:id/revisions/:rid` → `{ revision, plan }`
- `PATCH /projects/:id/revisions/:rid { note }` → `{ revision }` (a short label, ≤ 120 chars)
- Comparison runs in the browser: `diffPlans(a, b)` in `apps/shared/diff.ts` (rooms added / removed / resized,
  walls added / removed, doors, windows, net and gross area).

## Comments pinned to the plan
- `GET /projects/:id/comments` → `{ comments: [Comment] }`, oldest first; the client builds threads by `parent_id`.
- `Comment = { id, parent_id, plan_id, author: 'user' | 'ai', user_email, x, y, room_id, body, answer, resolved, created_at }`
  - `x, y` in plan metres (top-level comments only); `room_id` = room under the pin, set by the server.
  - `answer` (ai only) = the chat `Answer` object (text, claims, verified, issues…); `body` = its text.
- `POST /projects/:id/comments { body, x?, y?, plan_id?, parent_id?, ask_ai? }`
  - top level needs `x, y` (and `plan_id`, default latest); a reply needs `parent_id`.
  - `ask_ai: true` makes bimp answer in the thread: it gets the drawing sheet (the source render, with the pin marked),
    the room and elements around the pin, and the plan tools. → `{ comment, reply: Comment | null, ai_error?: string }`
- `POST /projects/:id/comments/:cid/ask { question? }` → `{ reply }` (asks about the thread; the question defaults to its last message)
- `PATCH /projects/:id/comments/:cid { resolved?, body? }` (`body`: author only; `resolved`: anyone with access)
- `DELETE /projects/:id/comments/:cid` (author or project owner); deletes replies too.

## Chat answers
- `POST /projects/:id/chat { message, region?, plan_id? }` → `{ message }`. `plan_id` is the revision (or PDF page) on the canvas; without it the latest plan is used.
- `message.content.claims[]`: `{ text, room_ids, item_ids?, evidence? }`. `evidence` is the crop of the source sheet: `{ render, size: [w, h], page, pages?, box, marks[] }`, boxes in render pixels; the image is `GET /projects/:id/render/:render`.
- `message.content.reasoning`: the steps from the plan to the answer, in words. `message.content.steps`: `[{ tool, found }]`, what was looked up and what came back, written by code (model answers only).
- `message.content.cost`: `{ by: 'code' | 'model', usd, calls, tokens_in, tokens_out, ms }`. `by: 'code'` means the answer was computed from the stored plan without a model call.
- Jobs (`GET /projects/:id/jobs/:jid`, and `jobs[]` of a project) carry `file_id` and `render_sha`: the sheet being read, shown on the canvas meanwhile.
- Plans: every room, opening and fitting read from a drawing has `src: { page, box }`; `plan.source.page` / `pages` say which page of the file the plan is.
- `PATCH /projects/:id/revisions/:rid/fixtures/:fid { kind, label?, similar? }` → `{ plan, named }`. Says what a symbol is: `kind` a fixture kind, or `unknown` with a `label` in the person's words; `similar: true` names the other unknown symbols of the same size too. Each answer is kept in `symbol_labels` (render, box, name) as a training example.
- `DELETE /projects/:id/jobs/:jid` stops a reading in progress → `{ ok, removed, message }`. A file that was never read into a plan is removed from the project with it (`removed: true`).
- `GET|POST /projects/:id/visuals`, `DELETE /projects/:id/visuals/:vid`: presentation images of the plan (POST body: a PNG snapshot; headers `x-style`, `x-prompt`). `POST /projects/:id/visuals/evidence { render, box }` → `{ url }`: the cited piece of a sheet as an image on Cloudinary's CDN.

`GET /api/projects/:id/revisions/:rid/reference` returns the revision's reference file as Markdown (`text/markdown`): everything worked out from the drawing, the document the chat answers from. A chat answer's `cost.by` is `code`, `cache` (given before for this plan) or `model`.
