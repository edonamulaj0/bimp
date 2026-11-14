// Brand marks as inline SVG, so they take the surrounding text colour (the app is light only).
import logoSvg from './brand/logo.svg?raw';
import spinSvg from './brand/loading.svg?raw';
import { useEffect, useRef } from 'preact/hooks';
import { playWordmark, wordmarkSvg } from './brand/wordmark';

export const Logo = ({ height = 28, title = 'bimp' }: { height?: number; title?: string }) => (
  <span class="brand-logo" style={{ height: `${height}px` }} role="img" aria-label={title} dangerouslySetInnerHTML={{ __html: logoSvg }} />
);

/** label=null: decorative (the text next to it says what is happening). */
export const Spinner = ({ size = 28, label = 'Loading' }: { size?: number; label?: string | null }) => (
  <span class="brand-spin" style={{ width: `${size}px`, height: `${size}px` }} {...(label === null ? { 'aria-hidden': 'true' } : { role: 'status', 'aria-label': label })}
    dangerouslySetInnerHTML={{ __html: spinSvg }} />
);

/** bimp AI's mark: the target from the wordmark's i (orange quarters, ring and crosshair), in the theme's ink. */
export const BimpMark = ({ size = 20, title }: { size?: number; title?: string }) => (
  <svg class="bimp-mark" width={size} height={size} viewBox="-47 -47 94 94" {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': 'true', focusable: 'false' })}>
    <circle r="34" fill="var(--surface, var(--paper))" />
    <path d="M 0 0 L 0 -34 A 34 34 0 0 1 34 0 Z" fill="var(--accent)" />
    <path d="M 0 0 L 0 34 A 34 34 0 0 1 -34 0 Z" fill="var(--accent)" />
    <circle r="34" fill="none" stroke="currentColor" stroke-width="6.5" />
    <line x1="0" y1="-45" x2="0" y2="45" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" />
    <line x1="-45" y1="0" x2="45" y2="0" stroke="currentColor" stroke-width="6.5" stroke-linecap="round" />
  </svg>
);

/** The wordmark drawing itself once (the sign-in page), in the theme's ink. */
export function AnimatedLogo({ height = 72, label = 'bimp' }: { height?: number; label?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current!;
    host.innerHTML = wordmarkSvg('wm', { ink: 'currentColor', disc: 'var(--paper)', guide: 'var(--line-strong)', label });
    return playWordmark(host.firstElementChild as SVGSVGElement);
  }, []);
  return <span ref={ref} class="brand-logo anim" style={{ height: `${height}px`, width: `${(height * 780) / 480}px` }} />;
}
