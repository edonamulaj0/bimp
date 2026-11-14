# bimp API (v2: teams, revisions, pinned comments)

All routes under `/api`, JSON, session cookie, same-origin check on non-GET. Errors: `{ error }` with a status.

## Access
A project is reachable by its owner (`projects.user_id`) and by every member of its team (`projects.team_id`).
`role` on a project is `owner` (created it, or owns its team) or `member`. Only an owner deletes a project or moves it
between teams. Anyone with access can upload, ask, comment and label revisions.

## Me
`GET /me` → `{ user: {id, email}, ai: boolean, teams: [{ id, name, role: 'owner'|'member' }] }`

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
