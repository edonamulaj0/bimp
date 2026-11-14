// Question router: recognises the challenge's fixed question templates (English, Finnish, German) and answers them
// with code from what was measured on the drawing, without a language model. Unrecognised questions return null and
// go to the chat agent.

export type Detection = { kind: string; conf: number; bbox: [number, number, number, number] };
/** What the router may read: the parts of an ingestion result that do not come from a language model. */
export type Evidence = { kind: string; detections?: Detection[] | null };
export type Routed = { template: string; answer: number | null; boxes: Detection[] };

/** Templates answered by counting one symbol class of the detector (ml/classes.py). First match wins. */
const SYMBOL_TEMPLATES: { template: string; kind: string; re: RegExp }[] = [
  { template: 'count_shower_bath', kind: 'shower_bath', re: /showers and bathtubs|suihkua ja kylpyammetta/i },
  { template: 'count_sink', kind: 'sink', re: /sinks and wash basins|pesu- ja tiskiallasta/i },
  { template: 'count_toilet', kind: 'toilet', re: /toilet bowls|WC-istuinta/i },
  { template: 'count_window', kind: 'window', re: /how many windows are shown|kuinka monta ikkunaa/i },
  { template: 'count_door', kind: 'door', re: /how many doors are shown|kuinka monta ovea/i },
];

/** The template a question matches, or null. */
export function templateOf(question: string): string | null {
  return SYMBOL_TEMPLATES.find((t) => t.re.test(question))?.template ?? null;
}

/**
 * Answers a templated question from the evidence. `answer` is null when the template is known but the drawing has
 * nothing to answer it from (for example no detector results on a vector sheet). `boxes` are the counted items, in
 * render pixels, for the citation on the source sheet.
 */
export function route(question: string, ev: Evidence): Routed | null {
  const t = SYMBOL_TEMPLATES.find((x) => x.re.test(question));
  if (!t) return null;
  if (!ev.detections) return { template: t.template, answer: null, boxes: [] };
  const boxes = ev.detections.filter((d) => d.kind === t.kind);
  return { template: t.template, answer: boxes.length, boxes };
}
