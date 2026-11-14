import { computed, signal } from '@preact/signals';

export type User = { id: string; email: string };
export type TeamRef = { id: string; name: string; role: 'owner' | 'member' };
export const user = signal<User | null | undefined>(undefined); // undefined = still checking
export const teams = signal<TeamRef[]>([]);
/** Whether the server can answer questions with AI (GET /me → ai). Plan, measures and checks work without it. */
export const ai = signal(true);
export const AI_OFF = 'Answers are switched off on this server right now. The plan, measurements and checks still work.';
export const route = signal(location.hash);
addEventListener('hashchange', () => (route.value = location.hash));
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
