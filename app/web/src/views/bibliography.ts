// Bibliography: works outside the archive that the documents cite, by kind, each with the pages that cite it.
// State in the URL: #/bibliography?kind=court&all=1&sort=az. The text filter and the CSV download work on what is shown.
import { api } from '../api.ts';
import { h, setTitle, entityLink, readerHref, entityHref, safeUrl, EXTERNAL_REL } from '../dom.ts';
import type { BibEntry, WorkKind } from '../types.ts';

export const KINDS: Array<[WorkKind, string, string]> = [
  ['parliamentary', 'Parliamentary documents', 'Drucksachen, protocols and research-service papers that are not in the archive'],
  ['court', 'Court decisions', 'By court, date and file number, or by the official collection (BVerfGE, BVerwGE, VerfGHE)'],
  ['legislation', 'Legislation', 'Laws and amendments by their place in the Bundesgesetzblatt or a Land gazette'],
  ['literature', 'Literature', 'Journal articles and commentaries; authors where the citation names them'],
  ['web', 'Web sources', 'Addresses as given in the documents, imprints and footers left out. The pages may have moved or changed owner since'],
];

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export async function bibliographyView(params: URLSearchParams): Promise<Node> {
  setTitle('Bibliography');
  const all = await api.bibliography();
  const kind = (KINDS.find(([k]) => k === params.get('kind'))?.[0] ?? '') as WorkKind | '';
  const everything = params.get('all') === '1';
  const sort = params.get('sort') === 'az' ? 'az' : 'cited';
  const hrefWith = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k); else p.set(k, v);
    return `#/bibliography?${p}`;
  };

  // Citations shown: by default only those on pages about wind power (compiled Anfragen documents hold unrelated answers).
  const entries = all
    .map((e) => ({ ...e, citations: everything ? e.citations : e.citations.filter((c) => c.on_topic) }))
    .filter((e) => e.citations.length);
  const count = (k: WorkKind) => entries.filter((e) => e.kind === k).length;

  let filter = '';
  const listBox = h('div', { class: 'bib-list' });
  const shownNote = h('p', { class: 'muted small' });
  const visible = (): BibEntry[] => {
    const f = filter.trim().toLowerCase();
    return entries.filter((e) => (!kind || e.kind === kind)
      && (!f || e.label.toLowerCase().includes(f) || (e.url ?? '').toLowerCase().includes(f) || e.citations.some((c) => c.doc.label.toLowerCase().includes(f))));
  };
  const draw = () => {
    const shown = visible();
    shownNote.textContent = `${shown.length.toLocaleString('en')} works, ${shown.reduce((a, e) => a + e.citations.length, 0).toLocaleString('en')} citations`;
    listBox.replaceChildren(...KINDS.filter(([k]) => !kind || k === kind).map(([k, title, note]) => {
      const group = shown.filter((e) => e.kind === k)
        .sort(sort === 'az' ? (a, b) => collator.compare(a.label, b.label) : (a, b) => docCount(b) - docCount(a) || b.citations.length - a.citations.length || collator.compare(a.label, b.label));
      if (!group.length) return null;
      return h('section', { class: 'bib-group' },
        h('h2', {}, title, h('span', { class: 'count' }, String(group.length))),
        h('p', { class: 'muted small' }, note),
        h('ol', { class: 'bib-entries' }, ...group.map(entry)));
    }).filter(Boolean) as Node[]);
    if (!shown.length) listBox.replaceChildren(h('p', { class: 'muted' }, 'Nothing matches.'));
  };
  draw();

  return h('div', { class: 'bibliography' },
    h('h1', {}, 'Bibliography'),
    h('p', { class: 'lede-small' }, 'The works outside the archive that the archived documents cite: parliamentary documents, court decisions, legislation, legal literature and web sources. ',
      'They were found by pattern in the full text and are not reviewed; every citation links to the page it was found on.'),
    h('div', { class: 'viz-controls', role: 'group', 'aria-label': 'Kind of work' },
      h('a', { href: hrefWith('kind', null), class: 'chip', 'aria-current': !kind ? 'true' : null }, `All ${entries.length.toLocaleString('en')}`),
      ...KINDS.map(([k, title]) => h('a', { href: hrefWith('kind', k), class: 'chip', 'aria-current': kind === k ? 'true' : null }, `${title} ${count(k)}`))),
    h('div', { class: 'bib-tools' },
      h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: !everything, onchange: () => { location.hash = hrefWith('all', everything ? null : '1'); } }),
        ' Only citations on pages about wind power'),
      h('span', { class: 'small' }, 'Sort: ',
        h('a', { href: hrefWith('sort', null), 'aria-current': sort === 'cited' ? 'true' : null }, 'most cited'), ' · ',
        h('a', { href: hrefWith('sort', 'az'), 'aria-current': sort === 'az' ? 'true' : null }, 'A–Z')),
      h('input', { type: 'search', class: 'filter', placeholder: 'Filter', 'aria-label': 'Filter the bibliography', oninput: (e: Event) => { filter = (e.target as HTMLInputElement).value; draw(); } }),
      h('button', { type: 'button', onclick: () => downloadCsv(visible()) }, 'Download CSV')),
    shownNote,
    listBox);
}

const docCount = (e: BibEntry) => new Set(e.citations.map((c) => c.doc.id)).size;

function entry(e: BibEntry): Node {
  const docs = docCount(e);
  const title = e.entity ? entityLink(e.entity)
    : safeUrl(e.url) ? h('a', { href: safeUrl(e.url), target: '_blank', rel: EXTERNAL_REL, class: 'bib-url' }, e.label)
    : h('span', { class: 'bib-label' }, e.label);
  // Grouped by citing document: "BT Drs 18/1310, pp. 3, 7".
  const byDoc = new Map<string, BibEntry['citations']>();
  for (const c of e.citations) byDoc.set(c.doc.id, [...(byDoc.get(c.doc.id) ?? []), c]);
  return h('li', { class: 'bib-entry' },
    h('div', {}, title, h('span', { class: 'muted small' }, ` · cited on ${e.citations.length} ${e.citations.length === 1 ? 'page' : 'pages'}${docs > 1 ? ` of ${docs} documents` : ''}`)),
    h('details', {},
      h('summary', { class: 'small' }, 'Where it is cited'),
      h('ul', { class: 'bib-cites' }, ...[...byDoc.values()].map((cs) => h('li', {},
        h('a', { href: entityHref(cs[0].doc.id) }, cs[0].doc.label), ': ',
        ...cs.flatMap((c, i) => [i ? ', ' : '', h('a', { href: readerHref(c.file_id, c.page, c.quote ? { q: c.quote } : {}), title: c.quote ?? '' }, `p. ${c.page}`)]),
        cs[0].quote ? h('span', { class: 'muted small' }, ` “${cs[0].quote}”`) : null)))));
}

function downloadCsv(entries: BibEntry[]): void {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['kind', 'citation', 'url', 'entity', 'cited_on_pages', 'citing_documents', 'citations'].map(cell).join(',')];
  for (const e of entries) {
    rows.push([e.kind, e.label, e.url, e.entity?.id, e.citations.length, docCount(e),
      e.citations.map((c) => `${c.doc.label} p. ${c.page}`).join('; ')].map(cell).join(','));
  }
  const a = h('a', { href: URL.createObjectURL(new Blob([`﻿${rows.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' })), download: '10h-bibliography.csv' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
