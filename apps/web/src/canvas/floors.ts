// Procedural floor materials (no image files): drawn once on a canvas, one texture = 1 m × 1 m of floor.
// A visual convention by room type, not data read from the drawing.
import * as THREE from 'three';
import type { RoomType } from '../../../shared/plan';
import { type FloorKind, FLOOR_OF } from './floors-kind';

// Small seeded PRNG so textures look the same on every load.
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const PX = 512; // pixels per metre

function draw(kind: FloorKind): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const g = c.getContext('2d')!, r = rng(7);
  const shade = (base: [number, number, number], k: number) => `rgb(${base.map((v) => Math.round(Math.min(255, v * k))).join(',')})`;
  if (kind === 'wood') {
    // 150 mm planks running along x, staggered butt joints, faint grain
    const plank = PX * 0.15, base: [number, number, number] = [214, 184, 146];
    for (let y = 0; y < PX; y += plank) {
      let x = -r() * PX * 0.6;
      while (x < PX) {
        const len = PX * (0.6 + r() * 0.6);
        g.fillStyle = shade(base, 0.9 + r() * 0.16);
        g.fillRect(x, y, len, plank);
        g.strokeStyle = 'rgba(90,60,30,0.10)'; g.lineWidth = 1;
        for (let k = 0; k < 4; k++) { const gy = y + plank * (0.2 + r() * 0.6); g.beginPath(); g.moveTo(x, gy); g.bezierCurveTo(x + len / 3, gy + 2, x + (2 * len) / 3, gy - 2, x + len, gy); g.stroke(); }
        g.fillStyle = 'rgba(70,45,20,0.35)'; g.fillRect(x, y, 2, plank);
        x += len;
      }
      g.fillStyle = 'rgba(70,45,20,0.35)'; g.fillRect(0, y, PX, 2);
    }
  } else if (kind === 'tiles') {
    // 300 mm tiles with grout
    const t = PX * 0.3, base: [number, number, number] = [236, 236, 232];
    g.fillStyle = '#b9b7b0'; g.fillRect(0, 0, PX, PX);
    for (let y = 0; y < PX + t; y += t) for (let x = 0; x < PX + t; x += t) {
      g.fillStyle = shade(base, 0.96 + r() * 0.05);
      g.fillRect(x + 2, y + 2, t - 4, t - 4);
    }
  } else if (kind === 'concrete') {
    g.fillStyle = '#c9c7c2'; g.fillRect(0, 0, PX, PX);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '60,60,60'},${0.04 + r() * 0.05})`; g.fillRect(r() * PX, r() * PX, 2 + r() * 6, 2 + r() * 6); }
  } else if (kind === 'deck') {
    const b = PX * 0.12, base: [number, number, number] = [176, 132, 92];
    for (let y = 0; y < PX; y += b) { g.fillStyle = shade(base, 0.9 + r() * 0.15); g.fillRect(0, y, PX, b - 6); g.fillStyle = '#5b4632'; g.fillRect(0, y + b - 6, PX, 6); }
  } else {
    g.fillStyle = '#efefeb'; g.fillRect(0, 0, PX, PX);
  }
  return c;
}

const cache = new Map<FloorKind, THREE.CanvasTexture>();
export function floorTexture(type: RoomType): THREE.CanvasTexture {
  const kind = FLOOR_OF[type];
  let t = cache.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(draw(kind));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(kind, t);
  }
  return t;
}
