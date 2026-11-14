import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

export type CmItem = { label: string; icon?: string; hint?: string; onSelect(): void; checked?: boolean; disabled?: boolean; danger?: boolean };
export type CmSection = { title?: string; items: CmItem[] };

/**
 * The canvas context menu (right click, double click, long press): tools, measuring, layers and views at the pointer.
 * A floating ARIA menu; on touch screens it docks to the bottom as a sheet. Escape or a click outside closes it.
 */
export function CanvasMenu({ x, y, title, sections, onClose }: { x: number; y: number; title?: string; sections: CmSection[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const back = useRef(document.activeElement as HTMLElement | null);
  const sheet = matchMedia('(max-width: 899px)').matches;
  useLayoutEffect(() => {
    const el = ref.current!, r = el.getBoundingClientRect(), m = 8;
    setPos({ left: Math.max(m, Math.min(x, innerWidth - r.width - m)), top: Math.max(m, Math.min(y, innerHeight - r.height - m)) });
  }, [x, y]);
  useEffect(() => {
    entries()[0]?.focus();
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => addEventListener('pointerdown', away), 0);
    const blur = () => onClose();
    addEventListener('resize', blur);
    return () => { clearTimeout(t); removeEventListener('pointerdown', away); removeEventListener('resize', blur); back.current?.isConnected && back.current.focus({ preventScroll: true }); };
  }, []);
  const entries = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
  const keys = (e: KeyboardEvent) => {
    const list = entries(), i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
  };
  return (
    <>
      {sheet && <div class="cm-scrim" aria-hidden="true" />}
      <div ref={ref} class={`cm${sheet ? ' as-sheet' : ''}`} role="menu" aria-label={title ?? 'Canvas'} onKeyDown={keys} onContextMenu={(e) => e.preventDefault()}
        style={sheet ? undefined : { left: `${pos.left}px`, top: `${pos.top}px` }}>
        {title && <div class="cm-title" aria-hidden="true">{title}</div>}
        {sections.map((s, i) => (
          <div key={i} role="group" aria-label={s.title} class="cm-group">
            {s.title && <div class="cm-h" aria-hidden="true">{s.title}</div>}
            {s.items.map((it) => (
              <button key={it.label} type="button" role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={it.checked} disabled={it.disabled}
                class={`cm-item${it.danger ? ' danger' : ''}`} onClick={() => { onClose(); it.onSelect(); }}>
                <span class="cm-ico" aria-hidden="true">{it.checked !== undefined ? (it.checked ? <Icon name="check" size={16} /> : null) : it.icon ? <Icon name={it.icon} size={16} /> : null}</span>
                <span class="cm-label">{it.label}</span>
                {it.hint && <kbd aria-hidden="true">{it.hint}</kbd>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
