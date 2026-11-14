// Brand marks as inline SVG, so they take the surrounding text colour (dark on light, light in dark mode).
import logoSvg from './brand/logo.svg?raw';
import spinSvg from './brand/loading.svg?raw';

export const Logo = ({ height = 28, title = 'bimp' }: { height?: number; title?: string }) => (
  <span class="brand-logo" style={{ height: `${height}px` }} role="img" aria-label={title} dangerouslySetInnerHTML={{ __html: logoSvg }} />
);

/** label=null: decorative (the text next to it says what is happening). */
export const Spinner = ({ size = 28, label = 'Loading' }: { size?: number; label?: string | null }) => (
  <span class="brand-spin" style={{ width: `${size}px`, height: `${size}px` }} {...(label === null ? { 'aria-hidden': 'true' } : { role: 'status', 'aria-label': label })}
    dangerouslySetInnerHTML={{ __html: spinSvg }} />
);
