import type { ComponentChildren } from 'preact';

// Markdown for answers from bimp AI: paragraphs, headings, lists (nested), tables, quotes, code, bold, italic, links.
// Everything becomes Preact elements, never HTML strings, so text from a drawing or the model cannot inject markup.

const INLINE = /(`[^`\n]+`)|(\*\*(?=\S)[^\n]+?(?<=\S)\*\*|__(?=\S)[^\n]+?(?<=\S)__)|((?<![\w*])\*(?=[^\s*])[^*\n]+?(?<=[^\s*])\*(?!\w)|(?<![\w_])_(?=[^\s_])[^_\n]+?(?<=[^\s_])_(?!\w))|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?])/g;

function inline(s: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let at = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > at) out.push(s.slice(at, m.index));
    const t = m[0];
    if (m[1]) out.push(<code>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong>{inline(t.slice(2, -2))}</strong>);
    else if (m[3]) out.push(<em>{inline(t.slice(1, -1))}</em>);
    else if (m[4]) { const k = t.indexOf(']('); out.push(<a href={t.slice(k + 2, -1)} target="_blank" rel="noopener noreferrer">{inline(t.slice(1, k))}</a>); }
    else out.push(<a href={t} target="_blank" rel="noopener noreferrer">{t}</a>);
    at = m.index + t.length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

/** Lines of one paragraph or list item: a single line break in the source stays a line break. */
const lines = (ls: string[]) => ls.flatMap((l, i) => (i ? [<br />, ...inline(l)] : inline(l)));

const ITEM = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

type Item = { text: string[]; kids: string[] };
function list(src: string[]): ComponentChildren {
  const first = src[0].match(ITEM)!, base = first[1].length, ordered = /\d/.test(first[2]);
  const items: Item[] = [];
  for (const l of src) {
    const m = l.match(ITEM);
    if (m && m[1].length <= base + 1) items.push({ text: [m[3]], kids: [] });
    else if (m) items[items.length - 1].kids.push(l);                      // deeper marker: a nested list
    else if (items[items.length - 1].kids.length) items[items.length - 1].kids.push(l);
    else items[items.length - 1].text.push(l.trim());                      // continuation of the item's text
  }
  const body = items.map((it, i) => <li key={i}>{lines(it.text)}{it.kids.length > 0 && list(it.kids)}</li>);
  return ordered ? <ol start={Number(first[2].replace(/\D/g, '')) || 1}>{body}</ol> : <ul>{body}</ul>;
}

export function Markdown({ text }: { text: string }) {
  const src = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ComponentChildren[] = [];
  for (let i = 0; i < src.length;) {
    const l = src[i];
    if (!l.trim()) { i++; continue; }
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      const body: string[] = [];
      for (i++; i < src.length && !src[i].trim().startsWith(fence[1]); i++) body.push(src[i]);
      i++;
      out.push(<pre><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = l.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { const H = `h${Math.min(6, h[1].length + 2)}` as 'h3'; out.push(<H>{inline(h[2])}</H>); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push(<hr />); i++; continue; }
    if (ROW.test(l) && i + 1 < src.length && RULE.test(src[i + 1])) {
      const head = cells(l), rows: string[][] = [];
      for (i += 2; i < src.length && ROW.test(src[i]); i++) rows.push(cells(src[i]));
      out.push(<div class="md-table"><table><thead><tr>{head.map((c) => <th>{inline(c)}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr>{head.map((_, k) => <td>{inline(r[k] ?? '')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*>/.test(l)) {
      const body: string[] = [];
      for (; i < src.length && /^\s*>/.test(src[i]); i++) body.push(src[i].replace(/^\s*>\s?/, ''));
      out.push(<blockquote><Markdown text={body.join('\n')} /></blockquote>);
      continue;
    }
    if (ITEM.test(l)) {
      const body: string[] = [], head = l.match(ITEM)!, numbered = /\d/.test(head[2]);
      // a list runs until a blank line that is not followed by another item or an indented continuation,
      // or until the markers change kind (bullets after numbers, numbers after bullets) at its own level
      for (; i < src.length; i++) {
        const m = src[i].match(ITEM);
        if (m && body.length && m[1].length <= head[1].length + 1 && /\d/.test(m[2]) !== numbered) break;
        if (src[i].trim()) { if (!ITEM.test(src[i]) && !/^\s+\S/.test(src[i]) && body.length && !src[i - 1].trim()) break; body.push(src[i]); }
        else if (!(i + 1 < src.length && (ITEM.test(src[i + 1]) || /^\s+\S/.test(src[i + 1])))) break;
      }
      out.push(list(body));
      continue;
    }
    const para: string[] = [];
    for (; i < src.length && src[i].trim() && !ITEM.test(src[i]) && !/^\s*(```|~~~|>|#{1,6}\s)/.test(src[i]) && !(ROW.test(src[i]) && RULE.test(src[i + 1] ?? '')); i++) para.push(src[i].trim());
    out.push(<p>{lines(para)}</p>);
  }
  return <div class="md">{out}</div>;
}
