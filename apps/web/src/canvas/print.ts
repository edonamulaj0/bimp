// Prints the 2D plan at a true paper scale (1:ratio) using millimetre units, on the smallest ISO sheet that fits.
import type { Plan } from '../../../shared/plan';

const SHEETS: [string, number, number][] = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
const MARGIN = 10, TITLE = 16; // mm

export function sheetFor(plan: Plan, ratio: number, pad: number) {
  const w = ((plan.width + 2 * pad) * 1000) / ratio, h = ((plan.height + 2 * pad) * 1000) / ratio;
  for (const [name, a, b] of SHEETS) {
    if (w + 2 * MARGIN <= a && h + 2 * MARGIN + TITLE <= b) return { name, orient: 'landscape', w, h };
    if (w + 2 * MARGIN <= b && h + 2 * MARGIN + TITLE <= a) return { name, orient: 'portrait', w, h };
  }
  return null;
}

export function printPlan(svg: SVGSVGElement, plan: Plan, ratio: number, pad: number, title: string) {
  const sheet = sheetFor(plan, ratio, pad);
  if (!sheet) return alert(`At 1:${ratio} the plan is larger than A0. Choose a smaller scale (a bigger number).`);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('viewBox', `${-pad} ${-pad} ${plan.width + 2 * pad} ${plan.height + 2 * pad}`);
  clone.setAttribute('width', `${sheet.w}mm`);
  clone.setAttribute('height', `${sheet.h}mm`);
  clone.removeAttribute('class');
  clone.querySelectorAll('.pins, .diff').forEach((n) => n.remove()); // screen-only: comment pins, revision overlay
  // Scale bar in plan units (metres), drawn under the plan.
  const L = [1, 2, 5, 10, 20, 50].find((m) => (m * 1000) / ratio >= 30) ?? 50;
  const y = plan.height + pad * 0.55, t = Math.max(plan.width, plan.height) / 400;
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  for (let i = 0; i < 4; i++) {
    const r = document.createElementNS(ns, 'rect');
    Object.entries({ x: (i * L) / 4, y, width: L / 4, height: t * 3, fill: i % 2 ? '#fff' : '#000', stroke: '#000', 'stroke-width': t / 3 }).forEach(([k, v]) => r.setAttribute(k, String(v)));
    g.append(r);
  }
  const label = document.createElementNS(ns, 'text');
  Object.entries({ x: L + t * 4, y: y + t * 3, 'font-size': t * 9 }).forEach(([k, v]) => label.setAttribute(k, String(v)));
  label.textContent = `${L} m`;
  g.append(label);
  clone.append(g);

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: ${sheet.name} ${sheet.orient}; margin: ${MARGIN}mm; }
    :root { --wall: #111; --paper: #fff; --fg: #111; --accent: #c2410c; }
    body { margin: 0; font: 10pt system-ui, sans-serif; color: #111; }
    .tb { display: flex; justify-content: space-between; border-top: 0.5mm solid #111; padding-top: 2mm; margin-top: 3mm; }
    svg { display: block; }
  </style></head><body>${clone.outerHTML}
  <div class="tb"><b>${esc(title)}</b><span>Scale 1:${ratio} on ${sheet.name} · ${plan.measured ? 'Measured from the drawing' : 'Preview, not measured'} · bimp.</span></div>
  </body></html>`;
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
  document.body.append(frame);
  const w = frame.contentWindow!;
  w.document.open(); w.document.write(doc); w.document.close();
  setTimeout(() => { w.focus(); w.print(); setTimeout(() => frame.remove(), 1000); }, 300);
}

/**
 * The plan as a PNG: the whole plan on a white sheet with a thin edge, transparent around it, without the screen-only
 * layers (pins, hover targets, the answer note, the source drawing). For presentation images.
 */
export async function planSnapshot(svg: SVGSVGElement, plan: Plan, pad: number, width = 1800): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement, ns = 'http://www.w3.org/2000/svg';
  const m = pad * 0.25, x = -pad, y = -pad, w = plan.width + 2 * pad, h = plan.height + 2 * pad; // the sheet; m of clear space round it
  const px = Math.round(width), py = Math.round((width * (h + 2 * m)) / (w + 2 * m));
  clone.setAttribute('viewBox', `${x - m} ${y - m} ${w + 2 * m} ${h + 2 * m}`);
  clone.setAttribute('width', String(px)); clone.setAttribute('height', String(py));
  clone.setAttribute('xmlns', ns);
  clone.removeAttribute('class'); clone.removeAttribute('style');
  clone.querySelectorAll('.hits, .q-pins, .pins, .diff, .note-area, .region, .measures, .focus-ring, .escape, image').forEach((n) => n.remove());
  clone.querySelectorAll('[data-name]').forEach((n) => n.removeAttribute('visibility')); // names hidden over the source drawing belong on the sheet
  // an image drawn from an SVG sees no page styles: the colours the drawing refers to are set here, for a white sheet
  const style = document.createElementNS(ns, 'style');
  style.textContent = 'svg{--wall:#1e1d1b;--fg:#1e1d1b;--ink:#1e1d1b;--sheet:#ffffff;--paper:#ffffff;--surface:#ffffff;--accent:#ff682b;--muted:#6b6862}text{font-family:Helvetica,Arial,sans-serif;fill:#1e1d1b}';
  const sheet = document.createElementNS(ns, 'rect');
  Object.entries({ x, y, width: w, height: h, fill: '#ffffff', stroke: '#1e1d1b', 'stroke-width': w / 900 }).forEach(([k, v]) => sheet.setAttribute(k, String(v)));
  clone.prepend(style, sheet);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('The plan could not be captured.')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = py;
    canvas.getContext('2d')!.drawImage(img, 0, 0, px, py);
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('The plan could not be captured.'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
