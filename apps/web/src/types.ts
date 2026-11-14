import type { Plan, RoomType } from '../../shared/plan';

export type TeamLink = { id: string; name: string } | null;
export type Thumb = { w: number; h: number; measured: boolean; method: string; rooms: { t: RoomType; p: [number, number][] }[]; net_m2: number };
export type ProjectRow = {
  id: string; name: string; updated_at: number; files: number; has_plan: number; thumb: Thumb | null;
  role: 'owner' | 'member'; team: TeamLink; revisions: number; comments: number;
};

/** An answer from bimp (chat, or an ai comment's `answer`). */
export type Content = {
  text: string; kind?: 'system' | 'error'; claims?: { text: string; room_ids: string[]; item_ids?: string[]; evidence?: import('../../shared/plan').Evidence }[]; calculation?: string | null;
  assumptions?: string[]; not_found?: boolean; verified?: boolean; issues?: string[];
  /** How the answer was produced and what it cost: by code from the stored plan (free), by model calls, or the cost of reading a drawing. */
  cost?: { by: 'code' | 'model' | 'reading'; usd: number; calls?: number; tokens_in?: number; tokens_out?: number; ms?: number; note?: string };
  /** A question asked about a marked region of the plan. */
  region?: import('../../shared/region').Region;
};
export type Msg = { id?: string; role: 'user' | 'assistant'; content: Content; created_at?: number; user_email?: string | null };
export type Job = { id: string; status: string; stage: string; error?: string | null; file_id?: string; render_sha?: string | null };
export type Revision = { id: string; rev: number; file_id: string | null; filename: string | null; note: string | null; created_at: number; rooms: number; net_m2: number; measured: boolean | number };
export type ProjectData = {
  project: { id: string; name: string; created_at: number; updated_at: number; role: 'owner' | 'member'; team: TeamLink };
  plan: Plan | null; plan_id: string | null; revisions: Revision[]; files: unknown[]; jobs: Job[]; messages: Msg[];
};
export type Comment = {
  id: string; parent_id: string | null; plan_id: string | null; author: 'user' | 'ai'; user_email: string | null;
  x: number | null; y: number | null; room_id: string | null; body: string; answer: Content | null; resolved: boolean | number; created_at: number;
};
