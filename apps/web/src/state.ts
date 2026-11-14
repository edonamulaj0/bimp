import { computed, signal } from '@preact/signals';

export type User = { id: string; email: string };
export type TeamRef = { id: string; name: string; role: 'owner' | 'member' };
export const user = signal<User | null | undefined>(undefined); // undefined = still checking
export const teams = signal<TeamRef[]>([]);
/** Whether the server can answer questions with AI (GET /me → ai). Plan, measures and checks work without it. */
export const ai = signal(true);
export const AI_OFF = 'Answers are switched off on this server right now. The plan, measurements and checks still work.';
export const route = signal(location.hash);
// Route changes crossfade (View Transitions) where the browser supports it and the reader hasn't asked for less motion.
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
addEventListener('hashchange', () => {
  const next = () => { route.value = location.hash; };
  const vt = (document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown }).startViewTransition;
  if (!vt || calm()) return next();
  vt.call(document, () => new Promise<void>((done) => { next(); setTimeout(done, 30); })); // one tick for the re-render
});
/** Switches light / dark (see public/js.js). */
export const toggleTheme = () => { (window as Window & { bimpTheme?: () => string }).bimpTheme?.(); };
export const go = (hash: string) => { location.hash = hash; };

/** Hash routes of the signed-in app. */
export type Route =
  | { page: 'projects'; team: string | null } // team: a team id, 'personal', or null = all
  | { page: 'project'; id: string }
  | { page: 'team'; id: string };
export const parsed = computed<Route>(() => {
  const h = route.value;
  let m = h.match(/^#\/p\/([\w-]+)/);
  if (m) return { page: 'project', id: m[1] };
  m = h.match(/^#\/team\/([\w-]+)\/settings/);
  if (m) return { page: 'team', id: m[1] };
  m = h.match(/^#\/team\/([\w-]+)/);
  if (m) return { page: 'projects', team: m[1] };
  if (h.startsWith('#/personal')) return { page: 'projects', team: 'personal' };
  return { page: 'projects', team: null };
});

/** App shell: the sidebar (collapsed on desktop, or open as a drawer on narrow screens). */
export const sidebarCollapsed = signal((() => { try { return localStorage.getItem('bimp.sidebar') === 'collapsed'; } catch { return false; } })());
export const drawerOpen = signal(false);
/** Open the "New project" dialog (from the sidebar or the projects page); value = preselected team id or 'personal'. */
export const newProject = signal<string | null>(null);
export const newTeam = signal(false);
/** Bumped when projects change, so lists reload. */
export const projectsVersion = signal(0);

/** Linked selection across chat, 2D and 3D. */
export const hoverRoom = signal<string | null>(null);
export const selectedRooms = signal<string[]>([]);

/** A question for the chat to send (set by the canvas, e.g. 'Ask AI for an overview'). */
export const chatPrompt = signal<string | null>(null);

/** Polite announcements for screen readers (pins placed, comments posted…). */
export const announce = signal('');
export const say = (t: string) => { announce.value = ''; requestAnimationFrame(() => (announce.value = t)); };

/** The markup region on the canvas (plan metres). While set, questions in the chat are answered from inside it only. */
export const region = signal<import('../../shared/region').Region | null>(null);
/** Files dropped on the file tree or the canvas, waiting for the chat to upload and read them (one at a time). */
export const uploadQueue = signal<File[]>([]);
export const ACCEPT = ['.pdf', '.dxf', '.png', '.jpg', '.jpeg', '.webp'];
/** Splits dropped files into ones bimp can read and ones it can't (with the reason), and queues the readable ones. */
export function queueFiles(files: Iterable<File>): string[] {
  const ok: File[] = [], refused: string[] = [];
  for (const f of files) {
    const ext = f.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
    if (ACCEPT.includes(ext)) { if (f.size > 50 * 1024 * 1024) refused.push(`${f.name}: larger than 50 MB`); else ok.push(f); }
    else if (ext === '.dwg') refused.push(`${f.name}: DWG isn't read yet. Export it to DXF or PDF from your CAD tool.`);
    else if (ext === '.ifc' || ext === '.rvt' || ext === '.skp') refused.push(`${f.name}: ${ext.slice(1).toUpperCase()} models aren't read yet. Export plans to PDF or DXF.`);
    else refused.push(`${f.name}: not a drawing bimp reads (PDF, DXF, PNG, JPG or WebP)`);
  }
  if (ok.length) uploadQueue.value = [...uploadQueue.value, ...ok];
  return refused;
}

/** Guided help: the welcome tour (step index, or null when closed) and the first-project tutorial. */
export const tourStep = signal<number | null>(null);
export const tutorialOpen = signal((() => { try { return localStorage.getItem('bimp.tutorial') === 'open'; } catch { return false; } })());
