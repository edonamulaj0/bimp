import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

export const when = (t: number) => {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 6) return `${Math.round(d / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};
export const fullDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export type MenuItem = { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; hint?: string } | 'sep';

/** A button that opens a menu (ARIA menu button): arrow keys move, Escape closes and returns focus. */
export function Menu({ label, items, icon = 'more', class: cls = '', text, align = 'right' }: {
  label: string; items: MenuItem[]; icon?: string; class?: string; text?: ComponentChildren; align?: 'left' | 'right' | 'up';
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const entries = () => [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
  useEffect(() => {
    if (!open) return;
    entries()[0]?.focus();
    const away = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', away);
    return () => removeEventListener('pointerdown', away);
  }, [open]);
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  const keys = (e: KeyboardEvent) => {
    const list = entries(), i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') close(false);
  };
  return (
    <div class={`menu ${cls}`}>
      <button ref={btn} type="button" class={text ? 'menu-btn has-text' : 'icon-btn'} aria-haspopup="menu" aria-expanded={open} aria-label={text ? undefined : label} title={text ? undefined : label}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        {text ?? <Icon name={icon} />}
      </button>
      {open && (
        <div ref={pop} class={`menu-pop ${align}`} role="menu" aria-label={label} onKeyDown={keys}>
          {items.map((it, i) => it === 'sep' ? <div key={i} class="menu-sep" role="separator" /> : (
            <button key={i} type="button" role="menuitem" class={it.danger ? 'danger' : ''} disabled={it.disabled} title={it.hint}
              onClick={() => { close(); it.onSelect(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A modal dialog (native <dialog>: focus is kept inside, Escape closes). */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose(): void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!, back = document.activeElement as HTMLElement | null;
    d.showModal();
    return () => { back?.isConnected && back.focus(); };
  }, []);
  return (
    <dialog ref={ref} class={`dlg${wide ? ' wide' : ''}`} aria-labelledby="dlg-title" onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div class="dlg-head"><h2 id="dlg-title">{title}</h2><button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </dialog>
  );
}
