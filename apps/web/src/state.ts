import { signal } from '@preact/signals';

export type User = { id: string; email: string };
export const user = signal<User | null | undefined>(undefined); // undefined = still checking
/** Whether the server can answer questions with AI (GET /me → ai). Plan, measures and checks work without it. */
export const ai = signal(true);
export const AI_OFF = 'Answers are switched off on this server right now. The plan, measurements and checks still work.';
export const route = signal(location.hash);
addEventListener('hashchange', () => (route.value = location.hash));
export const go = (hash: string) => { location.hash = hash; };

/** Linked selection across chat, 2D and 3D. */
export const hoverRoom = signal<string | null>(null);
export const selectedRooms = signal<string[]>([]);

/** A question for the chat to send (set by the canvas, e.g. 'Ask AI for an overview'). */
export const chatPrompt = signal<string | null>(null);
