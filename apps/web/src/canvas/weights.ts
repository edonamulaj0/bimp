// Line weights for the 2D plan (ISO 128-2 hierarchy). Widths are CSS px drawn with vector-effect: non-scaling-stroke,
// so they stay constant on screen and print at true pen widths (1 px = 0.265 mm at 96 dpi).
// Cut is heaviest, seen-below lighter, above-cut dashed and lightest; thickest : thinnest = 4.3 : 1 (≥ 2 : 1).
export const W = {
  exterior: 2.6,   // 0.70 mm  cut exterior / envelope walls
  bearing: 1.9,    // 0.50 mm  cut load-bearing interior walls
  partition: 1.2,  // 0.32 mm  cut partitions
  opening: 1.3,    // 0.35 mm  doors, windows, stairs
  fixture: 0.95,   // 0.25 mm  fixtures, built-ins, furniture
  thin: 0.6,       // 0.16 mm  hatching, dimensions, leaders, hidden / above cut (dashed)
} as const;

/** Wall class by measured thickness (Metric Handbook Ch. 37): envelope ≥ 250 mm, load-bearing 150–250, partition < 150. */
export const wallClass = (t: number) => (t >= 0.25 ? 'exterior' : t >= 0.15 ? 'bearing' : 'partition') as 'exterior' | 'bearing' | 'partition';

/** Stroke props for a non-scaling line of a given weight. */
export const ln = (w: number, dash?: string) => ({ stroke: 'var(--wall)', 'stroke-width': w, 'vector-effect': 'non-scaling-stroke', ...(dash ? { 'stroke-dasharray': dash } : {}) });
