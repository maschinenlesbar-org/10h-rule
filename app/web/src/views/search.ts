import { api } from '../api.ts';
import { h, setTitle, marked, entityLink, fmtDate, readerHref, typeLabel, badge } from '../dom.ts';
import type { Facet } from '../types.ts';

const MATCH_LABEL = { keyword: 'keyword', semantic: 'meaning', both: 'keyword + meaning' } as const;
const MATCH_TITLE = { keyword: 'Found by the words of the query', semantic: 'Found by similar meaning, not by the exact words', both: 'Found by both' } as const;
const FACET_NAMES: Record<string, string> = { kind: 'Document type', parliament: 'Parliament', year: 'Year' };
const PARLIAMENT: Record<string, string> = { bt: 'Bundestag', br: 'Bundesrat', by: 'Bayern', sn: 'Sachsen', mv: 'Mecklenburg-Vorpommern', ni: 'Niedersachsen', sh: 'Schleswig-Holstein' };

export async function searchView(params: URLSearchParams): Promise<Node> {
  const q = params.get('q') ?? '';
  const filters: Record<string, string> = {};
  for (const k of ['kind', 'parliament', 'year']) if (params.get(k)) filters[k] = params.get(k)!;
  setTitle(q ? `“${q}”` : 'Search');
  const [r, meta] = await Promise.all([api.search(q, { ...filters, mode: params.get('mode') ?? 'hybrid' }), api.meta()]);

  const hrefWith = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v === null) p.delete(k); else p.set(k, v);
    return `#/search?${p}`;
  };
  const facetBlock = (key: 'kind' | 'parliament' | 'year', items: Facet[]) => items.length ? h('div', { class: 'facet' },
    h('h3', {}, FACET_NAMES[key]),
    h('ul', {}, ...items.map((f) => {
      const active = filters[key] === f.value;
      return h('li', {}, h('a', { href: hrefWith(key, active ? null : f.value), class: active ? 'active' : '', 'aria-pressed': String(active) },
        key === 'parliament' ? PARLIAMENT[f.value] ?? f.value : f.value), h('span', { class: 'count' }, String(f.n)));
    }))) : null;

  const results = r.hits.map((hit) => h('article', { class: 'hit' },
    h('header', {},
      entityLink(hit.doc),
      h('span', { class: 'meta' }, [hit.doc.kind, hit.doc.parliament ? PARLIAMENT[hit.doc.parliament] : null, fmtDate(hit.doc.date)].filter(Boolean).join(' · '))),
    hit.doc.title ? h('div', { class: 'hit-title' }, hit.doc.title) : null,
    ...hit.passages.map((p) => h('p', { class: 'passage' },
      h('a', { class: 'page-link', href: readerHref(p.file_id, p.page_from, { q }) }, p.page_from === p.page_to ? `p. ${p.page_from}` : `pp. ${p.page_from}–${p.page_to}`),
      r.mode === 'hybrid' ? h('span', { class: `match match-${p.match}`, title: MATCH_TITLE[p.match] }, MATCH_LABEL[p.match]) : null,
      ' ', marked(p.snippet)))));

  const modeSwitch = meta.semantic ? h('p', { class: 'mode-switch' }, 'Search by ',
    h('a', { href: hrefWith('mode', null), 'aria-current': r.mode === 'hybrid' ? 'true' : null }, 'keyword and meaning'), ' · ',
    h('a', { href: hrefWith('mode', 'keyword'), 'aria-current': r.mode === 'keyword' ? 'true' : null }, 'keyword only'))
    : h('p', { class: 'muted small' }, 'Keyword search. Semantic search needs the local server with embeddings.');

  return h('div', { class: 'search' },
    h('h1', {}, q ? `Results for “${q}”` : 'Search'),
    modeSwitch,
    r.expandedWith.length ? h('p', { class: 'muted small' }, `Also searched for: ${r.expandedWith.join(', ')}`) : null,
    r.entities.length ? h('section', { class: 'entity-hits' },
      h('h2', { class: 'small-heading' }, 'Matching entries'),
      h('ul', { class: 'chips' }, ...r.entities.map((e) => h('li', {}, entityLink(e), ' ', badge(typeLabel(e.type)))))) : null,
    h('div', { class: 'search-layout' },
      h('aside', { class: 'facets', 'aria-label': 'Filters' },
        Object.keys(filters).length ? h('p', {}, h('a', { href: `#/search?${new URLSearchParams({ q })}` }, 'Clear filters')) : null,
        facetBlock('kind', r.facets.kind), facetBlock('parliament', r.facets.parliament), facetBlock('year', r.facets.year)),
      h('section', { class: 'results', 'aria-live': 'polite' },
        h('p', { class: 'muted' }, r.total ? `${r.total} documents${r.total > r.hits.length ? `, showing the best ${r.hits.length}` : ''}` : 'No documents found.'),
        ...results)));
}
