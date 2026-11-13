import { type Plan, area, roomStats, round } from '../../shared/plan';
import { calculate } from './calc';
import { ACCESS, BED, CORRIDOR, DOOR, FLAT_TRAVEL, GARAGE, OCCUPANCY, OCCUPANCY_REF, PLAN_SCALES, ROOM_STANDARDS, STAIR, TRAVEL, TRAVEL_REF, TURNING, WALL, checkPlan, escapeWidth } from '../../shared/standards';
import { escapeRoutes } from '../../shared/escape';
import { type Content, generate } from './gemini';
import type { Env } from './util';

export type Answer = {
  text: string;
  claims: { text: string; room_ids: string[] }[];
  calculation: string | null;
  assumptions: string[];
  not_found: boolean;
  verified: boolean;
  issues: string[];
};

const S = (type: string, description?: string, extra: object = {}) => ({ type, description, ...extra });
const TOOLS = [
  { name: 'plan_info', description: 'Overview of the plan: how it was produced, whether measured, scale source, assumptions, extent, counts.', parameters: S('OBJECT', undefined, { properties: {} }) },
  { name: 'list_rooms', description: 'All rooms with id, name, type, area_m2 and perimeter_m (computed from geometry).', parameters: S('OBJECT', undefined, { properties: {} }) },
  { name: 'get_room', description: 'One room by id: area, perimeter, bounding dimensions, doors and windows on its boundary.', parameters: S('OBJECT', undefined, { properties: { id: S('STRING') }, required: ['id'] }) },
  { name: 'count', description: 'Count doors, windows, or rooms of a type.', parameters: S('OBJECT', undefined, { properties: { what: S('STRING', 'door | window | room'), room_type: S('STRING', 'optional room type filter') }, required: ['what'] }) },
  { name: 'check_plan', description: 'Plausibility checks of the plan against design standards (room minimum sizes, corridor and door widths, scale). Each check cites its source.', parameters: S('OBJECT', undefined, { properties: {} }) },
  { name: 'space_standard', description: 'Design standard figures with their source: room minimum areas by type, door, corridor, stair, bed, wheelchair turning, preferred plan scales.', parameters: S('OBJECT', undefined, { properties: { topic: S('STRING', 'room type (bedroom, living, kitchen...), or door | corridor | stair | bed | turning | scale') }, required: ['topic'] }) },
  { name: 'escape_route', description: 'Estimated travel distance from the furthest point of each room (or one room) to an exit door, through doors, with the path and the limits that apply (Metric Handbook Ch. 41).', parameters: S('OBJECT', undefined, { properties: { room_id: S('STRING', 'optional room id') } }) },
  { name: 'occupancy', description: 'Occupant capacity of a room or the whole plan from floor space factors, and the minimum escape width for that many people (Ch. 41 Tables XI, XIV).', parameters: S('OBJECT', undefined, { properties: { use: S('STRING', `one of: ${Object.keys(OCCUPANCY).join(' | ')}`), room_id: S('STRING', 'optional; whole plan if omitted') }, required: ['use'] }) },
  { name: 'calculate', description: 'Evaluate arithmetic exactly. Supports + - * / ^ ( ) ceil floor round sqrt min max abs.', parameters: S('OBJECT', undefined, { properties: { expression: S('STRING') }, required: ['expression'] }) },
  {
    name: 'final_answer',
    description: 'Return the answer. Call exactly once, last.',
    parameters: S('OBJECT', undefined, {
      properties: {
        text: S('STRING', 'Answer in the user\'s language, plain and short.'),
        claims: S('ARRAY', 'Each factual claim with the room ids it comes from', { items: S('OBJECT', undefined, { properties: { text: S('STRING'), room_ids: S('ARRAY', undefined, { items: S('STRING') }) }, required: ['text', 'room_ids'] }) }),
        calculation: S('STRING', 'Formula with inputs and result, if any arithmetic was done', { nullable: true }),
        assumptions: S('ARRAY', undefined, { items: S('STRING') }),
        not_found: S('BOOLEAN', 'True if the plan does not contain the answer'),
      },
      required: ['text', 'claims', 'assumptions', 'not_found'],
    }),
  },
];

const SYSTEM = `You are BIMP, a BIM pilot. You answer questions about the floor plan of the user's project.
Rules: every fact must come from a tool result. Never estimate numbers yourself; do all arithmetic with calculate.
If the plan does not contain the answer, set not_found and say what you looked at. When the plan is not measured,
say that dimensions are approximate. Cite the rooms each claim comes from by id. For questions about sizes being
adequate, compliance or "is this right", use check_plan and space_standard and name the standard's source in the answer;
standards are guidance, not a legal verdict. For fire escape and capacity questions use escape_route and occupancy.
Finish by calling final_answer.
Answer in the language of the question.`;

function runTool(plan: Plan, name: string, args: any): unknown {
  const near = (o: { a: [number, number]; b: [number, number] }, poly: [number, number][]) => {
    const m: [number, number] = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    return poly.some((p, i) => {
      const q = poly[(i + 1) % poly.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const t = Math.max(0, Math.min(1, ((m[0] - p[0]) * (q[0] - p[0]) + (m[1] - p[1]) * (q[1] - p[1])) / L ** 2));
      return Math.hypot(m[0] - (p[0] + t * (q[0] - p[0])), m[1] - (p[1] + t * (q[1] - p[1]))) < 0.3;
    });
  };
  switch (name) {
    case 'plan_info':
      return { method: plan.method, measured: plan.measured, scale_source: plan.scale.source, assumptions: plan.assumptions,
        width_m: plan.width, height_m: plan.height, wall_height_m: plan.wallHeight, rooms: plan.rooms.length,
        doors: plan.openings.filter((o) => o.kind === 'door').length, windows: plan.openings.filter((o) => o.kind === 'window').length,
        total_room_area_m2: round(plan.rooms.reduce((s, r) => s + area(r.polygon), 0)) };
    case 'list_rooms':
      return plan.rooms.map(roomStats);
    case 'get_room': {
      const r = plan.rooms.find((x) => x.id === args.id);
      if (!r) return { error: `No room with id ${args.id}` };
      const xs = r.polygon.map((p) => p[0]), ys = r.polygon.map((p) => p[1]);
      const ops = plan.openings.filter((o) => near(o, r.polygon));
      return { ...roomStats(r), bbox_width_m: round(Math.max(...xs) - Math.min(...xs)), bbox_depth_m: round(Math.max(...ys) - Math.min(...ys)),
        doors: ops.filter((o) => o.kind === 'door').length, windows: ops.filter((o) => o.kind === 'window').length };
    }
    case 'count': {
      if (args.what === 'door' || args.what === 'window') return { what: args.what, count: plan.openings.filter((o) => o.kind === args.what).length };
      const rs = plan.rooms.filter((r) => !args.room_type || r.type === args.room_type);
      return { what: 'room', room_type: args.room_type ?? null, count: rs.length, room_ids: rs.map((r) => r.id) };
    }
    case 'check_plan':
      return checkPlan(plan);
    case 'space_standard': {
      const t = String(args.topic ?? '').toLowerCase();
      const room = ROOM_STANDARDS[t as keyof typeof ROOM_STANDARDS];
      if (room) return { topic: t, ...room };
      const table: Record<string, unknown> = { door: DOOR, corridor: CORRIDOR, stair: { ...STAIR, access: ACCESS }, bed: BED, turning: TURNING,
        garage: GARAGE, wall: WALL, access: ACCESS, fire: { flat_max_travel_m: FLAT_TRAVEL, travel_distance_m: TRAVEL, ref: TRAVEL_REF },
        occupancy: { m2_per_person: OCCUPANCY, ref: OCCUPANCY_REF },
        scale: { plan_scales: PLAN_SCALES, ref: 'Metric Handbook, 4th ed. Ch. 1 Table III' } };
      return table[t] ? { topic: t, ...(table[t] as object) } : { error: `No standard stored for "${t}". Known: ${[...Object.keys(ROOM_STANDARDS), ...Object.keys(table)].join(', ')}` };
    }
    case 'escape_route': {
      const esc = escapeRoutes(plan);
      if (!esc) return { error: 'No exit door found on the plan (a door with outside space on one side).' };
      const routes = esc.routes.filter((r) => !args.room_id || r.room_id === args.room_id).map((r) => ({ room_id: r.room_id, distance_m: r.distance_m, via_doors: r.via }));
      return { exits: esc.exits, routes, rooms_without_door: esc.unreachable, limits: { flat_without_alternative_exit_m: FLAT_TRAVEL.max, by_use_one_direction_and_more_m: TRAVEL },
        note: 'Straight lines through door centres; furniture ignored. ' + TRAVEL_REF };
    }
    case 'occupancy': {
      const f = OCCUPANCY[String(args.use)];
      if (!f) return { error: `Unknown use. Known: ${Object.keys(OCCUPANCY).join(', ')}` };
      const rs = args.room_id ? plan.rooms.filter((r) => r.id === args.room_id) : plan.rooms;
      const a = round(rs.reduce((t, r) => t + area(r.polygon), 0), 2);
      const people = Math.floor(a / f);
      return { use: args.use, area_m2: a, m2_per_person: f, people, escape: escapeWidth(people), ref: OCCUPANCY_REF };
    }
    case 'calculate':
      try { return { expression: args.expression, result: round(calculate(String(args.expression)), 4) }; }
      catch (e) { return { error: (e as Error).message }; }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Every number in the answer must appear in a tool result, the question, or a stated assumption (at the precision written). */
function verify(ans: Omit<Answer, 'verified' | 'issues'>, evidence: string, question: string, plan: Plan): string[] {
  const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
  const known = [...nums(evidence), ...nums(question), ...ans.assumptions.flatMap(nums)].map(Number);
  const issues: string[] = [];
  const said = [ans.text, ...ans.claims.map((c) => c.text), ans.calculation ?? ''].join(' ');
  for (const n of new Set(nums(said))) {
    const d = n.split('.')[1]?.length ?? 0;
    if (!known.some((k) => Math.abs(round(k, d) - Number(n)) < 1e-9)) issues.push(`The number ${n} does not come from the plan or a calculation`);
  }
  for (const c of ans.claims) for (const id of c.room_ids) if (!plan.rooms.some((r) => r.id === id)) issues.push(`Unknown room ${id}`);
  if (!ans.not_found && !ans.claims.length) issues.push('No source cited');
  return issues;
}

export async function ask(env: Env, plan: Plan, question: string, history: { role: 'user' | 'model'; text: string }[]): Promise<Answer> {
  const contents: Content[] = [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: 'user', parts: [{ text: question }] }];
  let evidence = '';
  for (let step = 0; step < 8; step++) {
    const reply = await generate(env, {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: TOOLS }],
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      generationConfig: { temperature: 0 },
    });
    contents.push(reply);
    const calls = reply.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    const final = calls.find((c) => c.name === 'final_answer');
    if (final) {
      const a = final.args ?? {};
      const ans = { text: String(a.text ?? ''), claims: Array.isArray(a.claims) ? a.claims : [], calculation: a.calculation ?? null,
        assumptions: Array.isArray(a.assumptions) ? a.assumptions : [], not_found: !!a.not_found };
      const issues = verify(ans, evidence, question, plan);
      return { ...ans, verified: issues.length === 0, issues };
    }
    if (!calls.length) break;
    contents.push({ role: 'user', parts: calls.map((c) => {
      const result = runTool(plan, c.name, c.args ?? {});
      evidence += JSON.stringify(result);
      return { functionResponse: { name: c.name, response: { result } } };
    }) });
  }
  return { text: 'I could not finish answering this question. Try rephrasing it.', claims: [], calculation: null, assumptions: [], not_found: true, verified: false, issues: ['Agent did not finish'] };
}
