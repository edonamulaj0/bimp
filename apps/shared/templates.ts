// Question router: recognises the challenge's fixed question templates (English, Finnish, German) and answers them
// with code from what was measured on the drawing, without a language model. Unrecognised questions return null and
// go to the chat agent.

export type Detection = { kind: string; conf: number; bbox: [number, number, number, number] };
type Box = [number, number, number, number];
/** A room read from its outline and label. `shade` is the fill of the outline on the sheet (see SHADE), null when unknown. */
export type DrawnRoom = { number: string; name: string | null; area_m2: number | null; unit: number | null; shade: number | null; bbox: Box | null };
/** What the ingestion service read exactly from a layered DXF or a vector PDF (ingest/service.py: dxf_layers, pdf_rooms). */
export type Layered = {
  rooms: DrawnRoom[];
  units: { index: number; name: string; bbox: Box }[];
  doors?: Box[];
  windows?: Box[];
  fixtures?: { kind: string; bbox: Box }[];
};
/** What the router may read: the parts of an ingestion result that do not come from a language model. */
export type Evidence = { kind: string; detections?: Detection[] | null; layered?: Layered | null };
export type Routed = { template: string; answer: number | null; boxes: Box[] };

/** Fill shades of room outlines on the Swiss dwellings sheets: outdoor spaces, shared spaces outside the units, shafts and voids. */
const SHADE = { outdoor: 0.89, shared: 0.95, void: 0.81 };
const OUTDOOR_NAME = /^(balkon|balcon|balcone|loggia|terrasse|terrazza|terrazzo)$/i;
const outdoor = (r: DrawnRoom) => (r.shade === null ? OUTDOOR_NAME.test(r.name ?? '') : r.shade === SHADE.outdoor);
const indoor = (r: DrawnRoom) => !outdoor(r) && r.shade !== SHADE.void;

/** Templates answered by counting one symbol class of the detector (ml/classes.py). First match wins. */
const SYMBOL_TEMPLATES: { template: string; kind: string; re: RegExp }[] = [
  { template: 'count_shower_bath', kind: 'shower_bath', re: /showers and bathtubs|suihkua ja kylpyammetta/i },
  { template: 'count_sink', kind: 'sink', re: /sinks and wash basins|pesu- ja tiskiallasta/i },
  { template: 'count_toilet', kind: 'toilet', re: /toilet bowls|WC-istuinta/i },
  { template: 'count_window', kind: 'window', re: /how many windows are shown|kuinka monta ikkunaa/i },
  { template: 'count_door', kind: 'door', re: /how many doors are shown|kuinka monta ovea/i },
];

type Found = { answer: number | null; boxes: Box[] };
const items = (boxes: Box[] | undefined): Found => (boxes ? { answer: boxes.length, boxes } : { answer: null, boxes: [] });
const fittings = (kind: string) => (l: Layered) => items(l.fixtures?.filter((f) => f.kind === kind).map((f) => f.bbox));
const sum = (rooms: DrawnRoom[]): Found => (rooms.some((r) => r.area_m2 === null) ? { answer: null, boxes: [] }
  : { answer: Math.round(rooms.reduce((a, r) => a + r.area_m2!, 0) * 100) / 100, boxes: rooms.flatMap((r) => (r.bbox ? [r.bbox] : [])) });
const boxesOf = (rooms: DrawnRoom[]) => rooms.flatMap((r) => (r.bbox ? [r.bbox] : []));

/**
 * Templates answered from an exactly read drawing (English, German, French, Italian). Capture groups are passed to
 * `find` in order. First match wins, so the more specific patterns come first.
 */
const LAYERED_TEMPLATES: { template: string; re: RegExp; find: (l: Layered, ...g: string[]) => Found }[] = [
  { template: 'area_rooms_labelled',
    re: /total net area in m² of all rooms labelled '(.+)' on|gesamte Nettofläche in m² aller Räume mit der Bezeichnung «(.+)» in|surface nette totale en m² de toutes les pièces désignées «\s*(.+?)\s*» à|superficie netta totale in m² di tutti i locali denominati «(.+)» in/i,
    find: (l, name) => { const rs = l.rooms.filter((r) => r.name === name); return rs.length ? sum(rs) : { answer: null, boxes: [] }; } },
  { template: 'area_floor',
    re: /total net floor area in m² of all numbered indoor|gesamte Nettogeschossfläche in m² aller nummerierten|surface nette totale en m² de toutes les pièces intérieures numérotées|superficie netta totale in m² di tutti i locali interni numerati/i,
    find: (l) => sum(l.rooms.filter(indoor)) },
  { template: 'area_apartment',
    re: /net floor area of apartment (\S+) in m²|Nettowohnfläche von Wohnung (\S+) in m²|surface nette de l'appartement (\S+) en m²|superficie netta dell'appartamento (\S+) in m²/i,
    find: (l, letter) => {
      const units = l.units.filter((u) => u.name.split(/\s+/).pop() === letter).map((u) => u.index);
      const rs = l.rooms.filter((r) => r.unit !== null && units.includes(r.unit) && indoor(r) && r.shade !== SHADE.shared);
      return rs.length ? sum(rs) : { answer: null, boxes: [] };
    } },
  { template: 'area_room',
    re: /net floor area of room (\S+) \('(.+)'\) in m²|Nettofläche von Raum (\S+) \(«(.+)»\) in m²|surface nette de la pièce (\S+) \(«\s*(.+?)\s*»\) en m²|superficie netta del locale (\S+) \(«(.+)»\) in m²/i,
    find: (l, number, name) => { const rs = l.rooms.filter((r) => r.number === number && r.name === name); return rs.length === 1 ? sum(rs) : { answer: null, boxes: [] }; } },
  { template: 'count_rooms_labelled',
    re: /how many rooms labelled '(.+)' are there|Wie viele Räume mit der Bezeichnung «(.+)» gibt es|Combien de pièces portant la désignation «\s*(.+?)\s*» y a-t-il|Quanti locali con la denominazione «(.+)» ci sono/i,
    find: (l, name) => { const rs = l.rooms.filter((r) => r.name === name); return { answer: rs.length, boxes: boxesOf(rs) }; } },
  { template: 'count_apartments', re: /how many apartments \(residential units\)|Wie viele Wohnungen sind|Combien d'appartements \(logements\)|Quanti appartamenti \(unità abitative\)/i,
    find: (l) => items(l.units.map((u) => u.bbox)) },
  { template: 'count_doors_drawn', re: /doors \(interior doors and entrance doors together\)|Türen \(Innentüren und Eingangstüren zusammen\)|portes \(portes intérieures et portes d'entrée confondues\)|porte \(porte interne e porte d'ingresso insieme\)/i,
    find: (l) => items(l.doors) },
  { template: 'count_windows_drawn', re: /how many windows are drawn|Wie viele Fenster sind|Combien de fenêtres sont dessinées|Quante finestre sono disegnate/i, find: (l) => items(l.windows) },
  { template: 'count_toilets_drawn', re: /how many toilets \(WC\) are drawn|Wie viele WCs sind|Combien de WC sont dessinés|Quanti WC sono disegnati/i, find: fittings('toilet') },
  { template: 'count_washbasins_drawn', re: /how many washbasins are drawn|Wie viele Lavabos sind|Combien de lavabos sont dessinés|Quanti lavabi sono disegnati/i, find: fittings('washbasin') },
  { template: 'count_bathtubs_drawn', re: /how many bathtubs are drawn|Wie viele Badewannen sind|Combien de baignoires sont dessinées|Quante vasche da bagno sono disegnate/i, find: fittings('bathtub') },
  { template: 'count_showers_drawn', re: /how many showers are drawn|Wie viele Duschen sind|Combien de douches sont dessinées|Quante docce sono disegnate/i, find: fittings('shower') },
];

/** The template a question matches, or null. */
export function templateOf(question: string): string | null {
  return SYMBOL_TEMPLATES.find((t) => t.re.test(question))?.template ?? LAYERED_TEMPLATES.find((t) => t.re.test(question))?.template ?? null;
}

/**
 * Answers a templated question from the evidence. `answer` is null when the template is known but the drawing has
 * nothing to answer it from (for example no detector results on a vector sheet). `boxes` are the counted items, in
 * render pixels, for the citation on the source sheet.
 */
export function route(question: string, ev: Evidence): Routed | null {
  const t = SYMBOL_TEMPLATES.find((x) => x.re.test(question));
  if (t) {
    if (!ev.detections) return { template: t.template, answer: null, boxes: [] };
    const boxes = ev.detections.filter((d) => d.kind === t.kind).map((d) => d.bbox);
    return { template: t.template, answer: boxes.length, boxes };
  }
  const l = LAYERED_TEMPLATES.find((x) => x.re.test(question));
  if (!l) return null;
  if (!ev.layered) return { template: l.template, answer: null, boxes: [] };
  const groups = (question.match(l.re) ?? []).slice(1).filter((g) => g !== undefined);
  return { template: l.template, ...l.find(ev.layered, ...groups) };
}
