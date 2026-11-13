import { signal } from '@preact/signals';

export type User = { id: string; email: string };
export const user = signal<User | null | undefined>(undefined); // undefined = still checking
export const route = signal(location.hash);
addEventListener('hashchange', () => (route.value = location.hash));
export const go = (hash: string) => { location.hash = hash; };

/** Linked selection across chat, 2D and 3D. */
export const hoverRoom = signal<string | null>(null);
export const selectedRooms = signal<string[]>([]);
