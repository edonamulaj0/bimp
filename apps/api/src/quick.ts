// Questions answered with plain code from the stored plan: no model call, no cost, and nothing to verify afterwards
// because every figure is computed here. Anything not recognised returns null and goes to the agent.
import { type Plan, type Room, area, round } from '../../shared/plan';
import { planAreas } from '../../shared/rooms';
import type { Answer } from './agent';
import { runTool } from './agent';

type Quick = Omit<Answer, 'verified' | 'issues'>;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const m2 = (r: Room) => round(area(r.polygon), 2);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Things that can be counted, by the words used for them. `what` and `room_type` are the count tool's arguments. */
const COUNTABLE: { re: RegExp; what: string; room_type?: string; one: string; many?: string }[] = [
  { re: /^(doors?|doorways?)$/, what: 'door', one: 'door' },
  { re: /^windows?$/, what: 'window', one: 'window' },
  { re: /^(rooms?|spaces?)$/, what: 'room', one: 'room' },
  { re: /^bedrooms?$/, what: 'room', room_type: 'bedroom', one: 'bedroom' },
  { re: /^bathrooms?$/, what: 'room', room_type: 'bathroom', one: 'bathroom' },
  { re: /^kitchens?$/, what: 'room', room_type: 'kitchen', one: 'kitchen' },
  { re: /^(toilets?|toilet bowls?|wcs?)$/, what: 'wc', one: 'toilet' },
  { re: /^(sinks?|basins?|wash ?basins?|sinks and wash ?basins)$/, what: 'sink', one: 'sink', many: 'sinks and wash basins' },
  { re: /^(bath ?tubs?|baths)$/, what: 'bathtub', one: 'bathtub' },
  { re: /^showers?$/, what: 'shower', one: 'shower' },
  { re: /^(showers and bath ?tubs|bath ?tubs and showers)$/, what: 'shower_bath', one: 'shower or bathtub', many: 'showers and bathtubs' },
  { re: /^beds?$/, what: 'bed', one: 'bed' },
  { re: /^(sofas?|couch(es)?)$/, what: 'sofa', one: 'sofa' },
  { re: /^tables?$/, what: 'table', one: 'table' },
  { re: /^desks?$/, what: 'desk', one: 'desk' },
  { re: /^wardrobes?$/, what: 'wardrobe', one: 'wardrobe' },
  { re: /^(fridges?|refrigerators?)$/, what: 'fridge', one: 'fridge' },
  { re: /^(stoves?|cookers?|hobs?)$/, what: 'stove', one: 'cooker', many: 'cookers' },
  { re: /^(washers?|washing machines?)$/, what: 'washer', one: 'washing machine' },
];
const WHOLE = /^(plan|whole plan|drawing|house|home|flat|apartment|building|floor|whole floor|unit|dwelling)$/;
const TAIL = /\s+(are there|are shown|are drawn|are shown on (the|this) (plan|drawing)|(are )?(in|on) (the|this) (plan|drawing|house|home|flat|apartment|building|floor)|does (it|the (plan|house|home|flat|apartment|building|floor)) have|(are )?in total|total)$/;

export function quickAnswer(question: string, plan: Plan): Quick | null {
  const q = norm(question);
  if (!q || q.length > 120) return null;
  const approx = plan.measured ? [] : ['The plan is a preview, not measured: figures are approximate'];
  const done = (text: string, claims: Quick['claims'], calculation: string | null = null): Quick => ({ text, claims, calculation, assumptions: approx, not_found: false });

  // how many <things>
  let m = q.match(/^how many (.+)$/);
  if (m) {
    let noun = m[1];
    for (let prev = ''; prev !== noun;) { prev = noun; noun = noun.replace(TAIL, ''); }
    const c = COUNTABLE.find((x) => x.re.test(noun));
    if (!c) return null;
    const r = runTool(plan, 'count', { what: c.what, room_type: c.room_type }) as { count: number; room_ids?: string[]; items?: { id: string; room_id: string | null }[]; source?: string; read_by_language_model?: number };
    const label = plural(r.count, c.one, c.many);
    const openings = c.what === 'door' || c.what === 'window' ? plan.openings.filter((o) => o.kind === c.what).map((o) => o.id) : [];
    const items = r.items?.map((i) => i.id) ?? openings;
    const rooms = r.room_ids ?? [...new Set((r.items ?? []).map((i) => i.room_id).filter((x): x is string => !!x))];
    // the detector's count is the answer on scans; when the drawn model disagrees, both are said
    const differs = r.source && r.read_by_language_model !== undefined && r.read_by_language_model !== r.count
      ? ` The drawn model shows ${r.read_by_language_model}; check the plan where they differ.` : '';
    return done(`There ${r.count === 1 ? 'is' : 'are'} **${label}** on this plan${r.source ? `, counted by the ${r.source}` : ''}.${differs}`,
      [{ text: label, room_ids: rooms, ...(items.length ? { item_ids: items } : {}) }]);
  }

  // total area
  if (/^(what is |what s |whats )?(the )?(total|overall|net|whole|entire) (net )?(floor |internal )?area( of (the|this) [a-z ]+)?$/.test(q) || /^how (big|large) is (the|this) (plan|house|home|flat|apartment|building|floor)$/.test(q)) {
    const a = planAreas(plan);
    return done(`The net floor area is **${a.net_floor_area_m2} m²** across ${plural(plan.rooms.length, 'room')}, measured to the inside faces of the walls. With the walls, the gross floor area is ${a.gross_floor_area_m2} m².`,
      [{ text: `Net floor area ${a.net_floor_area_m2} m²`, room_ids: plan.rooms.map((r) => r.id) }], `${plan.rooms.map((r) => m2(r)).join(' + ')} = ${a.net_floor_area_m2} m²`);
  }

  // largest / smallest room
  m = q.match(/^(which|what) is the (largest|biggest|smallest) room$/);
  if (m && plan.rooms.length) {
    const big = m[2] !== 'smallest', r = [...plan.rooms].sort((x, y) => (big ? -1 : 1) * (area(x.polygon) - area(y.polygon)))[0];
    return done(`The ${big ? 'largest' : 'smallest'} room is **${r.name}** at **${m2(r)} m²**.`, [{ text: `${r.name} ${m2(r)} m²`, room_ids: [r.id] }]);
  }

  // list the rooms
  if (/^(list|show|what are|which are|name)( me)?( all)?( the)? rooms( (in|on) (the|this) (plan|drawing|house|flat|apartment))?$/.test(q) || /^(what|which) rooms are (there|shown)$/.test(q)) {
    return done(`This plan has **${plural(plan.rooms.length, 'room')}**:\n\n${plan.rooms.map((r) => `- ${r.name}: ${m2(r)} m²`).join('\n')}`,
      plan.rooms.map((r) => ({ text: `${r.name} ${m2(r)} m²`, room_ids: [r.id] })));
  }

  // area of a named room
  m = q.match(/^(?:what is |what s |whats )?(?:the )?(?:net )?(?:floor )?(?:area|size) of (?:the )?(.+)$/) ?? q.match(/^how (?:big|large) is (?:the )?(.+)$/);
  if (m) {
    const want = m[1].replace(/ in (m2|square met(er|re)s)$/, '');
    if (WHOLE.test(want)) return null;
    const names = plan.rooms.map((r) => ({ r, n: norm(r.name) })).filter((x) => x.n);
    const exact = names.filter((x) => x.n === want);
    const hits = (exact.length ? exact : names.filter((x) => x.n.includes(want) || (x.n.length > 2 && want.includes(x.n)))).map((x) => x.r);
    if (!hits.length || hits.length > 6) return null;
    if (hits.length === 1) return done(`The **${hits[0].name}** is **${m2(hits[0])} m²** (net floor area, to the inside faces of the walls).`, [{ text: `${hits[0].name} ${m2(hits[0])} m²`, room_ids: [hits[0].id] }]);
    return done(`${hits.length} rooms match "${m[1]}":\n\n${hits.map((r) => `- **${r.name}:** ${m2(r)} m²`).join('\n')}`, hits.map((r) => ({ text: `${r.name} ${m2(r)} m²`, room_ids: [r.id] })));
  }
  return null;
}
