import type { ComponentChildren } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { type Plan, type RoomType, area, round } from '../../shared/plan';
import { ROOM_COLORS } from './canvas/colors';
import { hoverRoom, queueFiles, selectedRooms, uploadQueue, visualsOn, visualsOpen } from './state';
import { Icon } from './icons';
import { Dialog, when } from './ui';
import type { Revision } from './types';

export type FileRow = { id: string; filename: string; mime: string; size: number; created_at: number };
type Node = { id: string; label: ComponentChildren; text: string; icon?: string; meta?: ComponentChildren; children?: Node[];
  onOpen?(): void; onHover?(on: boolean): void; current?: boolean; swatch?: string; muted?: boolean };

const KIND: [string, string, (f: FileRow) => boolean][] = [
  ['pdf', 'PDF sheets', (f) => f.mime === 'application/pdf' || /\.pdf$/i.test(f.filename)],
  ['cad', 'CAD (DXF)', (f) => /\.dxf$/i.test(f.filename) || /dxf/.test(f.mime)],
  ['img', 'Scans and images', (f) => f.mime.startsWith('image/')],
];
const GROUPS: [string, RoomType[]][] = [
  ['Living spaces', ['living', 'dining', 'kitchen', 'office']], ['Bedrooms', ['bedroom']], ['Wet rooms', ['bathroom', 'wc', 'utility']],
  ['Circulation', ['circulation', 'stair', 'lift']], ['Storage and service', ['storage', 'garage', 'plant']], ['Outdoor and other', ['outdoor', 'other']],
];
const bytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/**
 * The project's files as a tree (drawings by kind, revisions, and the model's rooms), and the drop zone for new drawings.
 * ARIA tree: arrow keys move and open/close, Enter opens, Home/End jump.
 */
export function FileTree({ projectId, name, files, revisions, plan, latestId, viewedId, onViewRev, onAdd, onRefused }: {
  projectId: string; name: string; files: FileRow[]; revisions: Revision[]; plan: Plan | null; latestId: string | null; viewedId: string | null;
  onViewRev(id: string | null): void; onAdd(): void; onRefused(why: string[]): void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ root: true, drawings: true, 'k-pdf': true, 'k-cad': true, 'k-img': true, revisions: false, model: true, rooms: true });
  const [focus, setFocus] = useState('root');
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); // id of the file being looked at
  const depth = useRef(0);
  const tree = useRef<HTMLUListElement>(null);
  const revOfFile = useMemo(() => new Map(revisions.filter((r) => r.file_id).map((r) => [r.file_id!, r])), [revisions]);

  const root: Node = useMemo(() => {
    const drawings: Node[] = KIND.flatMap(([k, label, test]) => {
      const fs = files.filter(test);
      return fs.length ? [{ id: `k-${k}`, label, text: label, icon: 'folder', meta: fs.length, children: fs.map((f): Node => {
        const r = revOfFile.get(f.id);
        return { id: `f-${f.id}`, text: f.filename, label: <span class="mono ft-file">{f.filename}</span>, icon: 'file',
          meta: <>{r && <span class="ft-rev mono">r{r.rev}</span>}{bytes(f.size)}</>, current: preview === f.id || (!!r && (viewedId ?? latestId) === r.id),
          onOpen: () => setPreview(f.id) };
      }) }] : [];
    });
    const queued: Node[] = uploadQueue.value.map((f, i) => ({ id: `q-${i}`, text: f.name, label: <span class="mono ft-file">{f.name}</span>, icon: 'upload', meta: 'queued', muted: true }));
    const rooms = plan?.rooms ?? [];
    const groups: Node[] = GROUPS.flatMap(([label, types]) => {
      const rs = rooms.filter((r) => types.includes(r.type));
      return rs.length ? [{ id: `g-${label}`, label, text: label, icon: 'folder', meta: rs.length, children: rs.map((r): Node => ({
        id: `r-${r.id}`, text: r.name, label: r.name, swatch: ROOM_COLORS[r.type], meta: <span class="mono">{round(area(r.polygon), 1)} m²</span>,
        current: selectedRooms.value.includes(r.id),
        onOpen: () => { selectedRooms.value = selectedRooms.value.includes(r.id) ? [] : [r.id]; },
        onHover: (on) => { hoverRoom.value = on ? r.id : null; },
      })) }] : [];
    });
    const fx = plan?.fixtures ?? [];
    return {
      id: 'root', label: <b>{name}</b>, text: name, icon: 'project', children: [
        { id: 'drawings', label: 'Drawings', text: 'Drawings', icon: 'folder', meta: files.length || undefined,
          children: [...drawings, ...queued, ...(!files.length && !queued.length ? [{ id: 'none', text: 'No drawings yet', label: plan?.method === 'sample' ? 'Built from the pilot specification' : 'No drawings yet', muted: true }] : [])] },
        { id: 'revisions', label: 'Revisions', text: 'Revisions', icon: 'history', meta: revisions.length || undefined,
          children: revisions.length ? revisions.map((r): Node => ({ id: `v-${r.id}`, text: `r${r.rev}`, label: <><span class="mono">r{r.rev}</span>{r.note ? ` · ${r.note}` : r.filename ? ` · ${r.filename}` : ''}</>,
            meta: r.id === latestId ? 'latest' : when(r.created_at), current: (viewedId ?? latestId) === r.id, onOpen: () => onViewRev(r.id === latestId ? null : r.id) }))
            : [{ id: 'nrev', text: 'No revisions', label: 'No revisions yet', muted: true }] },
        ...(plan && visualsOn.value ? [{ id: 'images', label: 'Architectural images', text: 'Architectural images', icon: 'sparkle', onOpen: () => (visualsOpen.value = true) } as Node] : []),
        ...(plan ? [{ id: 'model', label: 'Model', text: 'Model', icon: 'cube', children: [
          { id: 'rooms', label: 'Rooms', text: 'Rooms', icon: 'folder', meta: rooms.length, children: groups },
          { id: 'openings', label: 'Doors and windows', text: 'Doors and windows', icon: 'door', meta: <>{plan.openings.filter((o) => o.kind === 'door').length} · {plan.openings.filter((o) => o.kind === 'window').length}</> },
          { id: 'fixtures', label: 'Fittings and furniture', text: 'Fittings and furniture', icon: 'sofa', meta: fx.length },
          { id: 'extent', label: 'Extent', text: 'Extent', icon: 'ruler', meta: <span class="mono">{plan.width} × {plan.height} m</span> },
        ] } as Node] : []),
      ],
    };
  }, [name, files, revisions, plan, latestId, viewedId, preview, uploadQueue.value, selectedRooms.value, visualsOn.value]);

  // visible nodes in order, for the keyboard
  const flat: { n: Node; level: number; parent: string | null }[] = [];
  const walk = (n: Node, level: number, parent: string | null) => { flat.push({ n, level, parent }); if (n.children && open[n.id]) n.children.forEach((c) => walk(c, level + 1, n.id)); };
  walk(root, 1, null);
  const move = (id: string) => { setFocus(id); requestAnimationFrame(() => tree.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus()); };
  const toggle = (id: string, v?: boolean) => setOpen((o) => ({ ...o, [id]: v ?? !o[id] }));
  const keys = (e: KeyboardEvent) => {
    const i = flat.findIndex((x) => x.n.id === focus), cur = flat[i];
    if (!cur) return;
    const k = e.key;
    if (k === 'ArrowDown') move(flat[Math.min(flat.length - 1, i + 1)].n.id);
    else if (k === 'ArrowUp') move(flat[Math.max(0, i - 1)].n.id);
    else if (k === 'Home') move(flat[0].n.id);
    else if (k === 'End') move(flat[flat.length - 1].n.id);
    else if (k === 'ArrowRight') { if (cur.n.children) { if (!open[cur.n.id]) toggle(cur.n.id, true); else if (cur.n.children[0]) move(cur.n.children[0].id); } }
    else if (k === 'ArrowLeft') { if (cur.n.children && open[cur.n.id]) toggle(cur.n.id, false); else if (cur.parent) move(cur.parent); }
    else if (k === 'Enter' || k === ' ') { if (cur.n.onOpen) cur.n.onOpen(); else if (cur.n.children) toggle(cur.n.id); }
    else return;
    e.preventDefault();
  };

  const item = (n: Node, level: number): ComponentChildren => {
    const isOpen = !!open[n.id], kids = n.children;
    return (
      <li key={n.id} role="treeitem" aria-level={level} aria-expanded={kids ? isOpen : undefined} aria-selected={n.current || undefined}
        data-node={n.id} tabIndex={focus === n.id ? 0 : -1} class="ft-item" onKeyDown={keys}
        onFocus={(e) => { if (e.target === e.currentTarget) setFocus(n.id); }}>
        <div class={`ft-row${n.current ? ' current' : ''}${n.muted ? ' muted' : ''}${n.onOpen ? ' act' : ''}`} style={{ '--lv': level - 1 }}
          onClick={(e) => { e.stopPropagation(); setFocus(n.id); if (kids && !(n.onOpen)) toggle(n.id); n.onOpen?.(); }}
          onPointerEnter={() => n.onHover?.(true)} onPointerLeave={() => n.onHover?.(false)}>
          <span class="ft-caret" aria-hidden="true" onClick={(e) => { if (kids) { e.stopPropagation(); toggle(n.id); } }}>{kids ? <Icon name="chevron" size={14} /> : null}</span>
          {n.swatch ? <i class="sw" style={{ background: n.swatch }} aria-hidden="true" /> : n.icon && <Icon name={n.icon} size={16} />}
          <span class="ft-label">{n.label}</span>
          {n.meta !== undefined && <span class="ft-meta">{n.meta}</span>}
        </div>
        {kids && isOpen && <ul role="group">{kids.map((c) => item(c, level + 1))}</ul>}
      </li>
    );
  };

  const drop = (e: DragEvent) => {
    e.preventDefault(); depth.current = 0; setOver(false);
    const fs = e.dataTransfer?.files;
    if (fs?.length) { const no = queueFiles([...fs]); if (no.length) onRefused(no); }
  };
  return (
    <section class={`files dock${over ? ' over' : ''}`} aria-labelledby="files-h" data-tour="files"
      onDragEnter={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); depth.current++; setOver(true); } }}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={() => { if (--depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={drop}>
      <div class="dock-h">
        <h2 id="files-h">Files</h2>
        <span class="spacer" />
        <button type="button" class="icon-btn xs" onClick={onAdd} aria-label="Add drawings" title="Add drawings (PDF, DXF, PNG, JPG, WebP)"><Icon name="plus" size={16} /></button>
      </div>
      <ul class="ft" role="tree" aria-labelledby="files-h" ref={tree}>{item(root, 1)}</ul>
      <button type="button" class="ft-drop" onClick={onAdd}>
        <Icon name="upload" size={16} /><span><b>Drop drawings here</b><span class="muted">PDF, DXF, PNG, JPG, WebP · up to 50 MB</span></span>
      </button>
      {over && <div class="drop-veil" aria-hidden="true"><Icon name="upload" size={22} /><b>Drop to add to {name}</b><span>Each drawing becomes the next revision</span></div>}
      {(() => {
        const f = files.find((x) => x.id === preview), r = f && revOfFile.get(f.id);
        return f && <FilePreview projectId={projectId} file={f} rev={r?.rev} shown={!!r && (viewedId ?? latestId) === r.id}
          onPlan={r ? () => { setPreview(null); onViewRev(r.id === latestId ? null : r.id); } : undefined} onClose={() => setPreview(null)} />;
      })()}
    </section>
  );
}

/** The uploaded drawing itself: an image as uploaded, a PDF or DXF as the sheet bimp rendered to read it. */
function FilePreview({ projectId, file, rev, shown, onPlan, onClose }: { projectId: string; file: FileRow; rev?: number; shown: boolean; onPlan?(): void; onClose(): void }) {
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading');
  const isImage = file.mime.startsWith('image/');
  const base = `/api/projects/${projectId}/files/${file.id}`;
  return (
    <Dialog title={file.filename} onClose={onClose} wide>
      <div class="dlg-body">
      <div class="fp-stage">
        {state !== 'none' && <img src={`${base}/preview`} alt={`${file.filename}, the uploaded drawing`} class={state === 'ok' ? '' : 'pending'}
          onLoad={() => setState('ok')} onError={() => setState('none')} />}
        {state === 'loading' && <p class="muted small" role="status">Loading the drawing…</p>}
        {state === 'none' && <p class="muted small">{isImage ? 'This image could not be shown. Download it to open it.' : 'No preview: this drawing has not been read yet. Download it to open it.'}</p>}
      </div>
      <div class="fp-foot">
        <span class="muted small">{isImage ? 'Image as uploaded' : 'Sheet as rendered for reading'} · {bytes(file.size)} · added {when(file.created_at)}</span>
        <span class="spacer" />
        <a class="btn ghost sm" href={base} download={file.filename}><Icon name="file" size={16} />Download</a>
        {onPlan && <button type="button" class="btn sm" onClick={onPlan}>{shown ? `Back to the plan (r${rev})` : `Show its plan (r${rev})`}</button>}
      </div>
      </div>
    </Dialog>
  );
}
