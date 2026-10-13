import { api } from '../api.ts';
import { h, setTitle, entityLink, fmtDate, badge } from '../dom.ts';
import type { ListRow } from '../types.ts';

interface Col { key: string; label: string; num?: boolean; fmt?: (v: any, r: ListRow) => Node | string }

const ARENA: Record<string, string> = { bt: 'Bundestag', br: 'Bundesrat', by: 'Bayern', sn: 'Sachsen', bund: 'Bund', 'bund-government': 'Bundesregierung' };
const PARL: Record<string, string> = { bt: 'BT', br: 'BR', by: 'BY', sn: 'SN', mv: 'MV', ni: 'NI', sh: 'SH' };

const LISTS: Record<string, { title: string; cols: Col[] }> = {
  people: { title: 'People', cols: [
    { key: 'party', label: 'Party' }, { key: 'asked', label: 'Asked', num: true }, { key: 'answered', label: 'Answered', num: true },
    { key: 'spoke', label: 'Speeches, statements', num: true }, { key: 'mentions', label: 'Mentions', num: true },
    { key: 'profile', label: 'Wiki profile', fmt: (v) => (v ? 'yes' : '') }] },
  documents: { title: 'Documents', cols: [
    { key: 'kind', label: 'Type' }, { key: 'parliament', label: 'Parl.', fmt: (v) => PARL[v] ?? v ?? '' },
    { key: 'date', label: 'Date', fmt: (v) => fmtDate(v) }, { key: 'title', label: 'Title' },
    { key: 'archived', label: 'Archived', fmt: (v) => (v ? 'yes' : '') }, { key: 'cited_by', label: 'Cited by', num: true }] },
  organizations: { title: 'Organisations', cols: [{ key: 'classification', label: 'Kind' }, { key: 'mentions', label: 'Mentions', num: true }] },
  places: { title: 'Places', cols: [{ key: 'classification', label: 'Kind' }, { key: 'mentions', label: 'Mentions', num: true }] },
  concepts: { title: 'Concepts', cols: [{ key: 'mentions', label: 'Mentions', num: true }] },
  laws: { title: 'Laws and provisions', cols: [{ key: 'mentions', label: 'Mentions', num: true }] },
};

export async function listView(_p: URLSearchParams, kind: string): Promise<Node> {
  if (kind === 'events') return eventsView();
  const def = LISTS[kind];
  if (!def) throw new Error('Unknown list');
  setTitle(def.title);
  const rows = await api.list(kind);
  let sortKey = '', asc = true, filter = '';
  const tbody = h('tbody');
  const count = h('p', { class: 'muted small' });
  const draw = () => {
    const f = filter.toLowerCase();
    let shown = rows.filter((r) => !f || r.label.toLowerCase().includes(f) || Object.values(r.cols).some((v) => String(v ?? '').toLowerCase().includes(f)));
    if (sortKey) {
      shown = [...shown].sort((a, b) => {
        const x = sortKey === 'label' ? a.label : a.cols[sortKey], y = sortKey === 'label' ? b.label : b.cols[sortKey];
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
        return asc ? c : -c;
      });
    }
    tbody.replaceChildren(...shown.slice(0, 1000).map((r) => h('tr', {},
      h('th', { scope: 'row' }, entityLink(r)),
      ...def.cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.fmt ? c.fmt(r.cols[c.key], r) : String(r.cols[c.key] ?? ''))))));
    count.textContent = `${shown.length} of ${rows.length}${shown.length > 1000 ? ', showing 1,000' : ''}`;
  };
  const th = (key: string, label: string, num = false) => h('th', { scope: 'col', class: num ? 'num' : '' },
    h('button', { type: 'button', class: 'sort', onclick: () => { asc = sortKey === key ? !asc : !num; sortKey = key; draw(); } }, label));
  draw();
  return h('div', { class: 'list' },
    h('h1', {}, def.title),
    h('input', { type: 'search', class: 'filter', placeholder: 'Filter', 'aria-label': 'Filter the list', oninput: (e: Event) => { filter = (e.target as HTMLInputElement).value; draw(); } }),
    count,
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, th('label', 'Name'), ...def.cols.map((c) => th(c.key, c.label, c.num)))), tbody)));
}

async function eventsView(): Promise<Node> {
  setTitle('Events');
  const rows = await api.list('events');
  const years = new Map<string, ListRow[]>();
  for (const r of rows) {
    const y = String(r.cols.date ?? '').slice(0, 4);
    years.set(y, [...(years.get(y) ?? []), r]);
  }
  return h('div', { class: 'events' },
    h('h1', {}, 'Events'),
    h('p', { class: 'muted' }, 'From the wiki’s timeline, Sachsen, Bayern and federal pages. ', h('a', { href: '#/story' }, 'The story timeline'), ' shows them in lanes per arena.'),
    ...[...years].map(([y, rs]) => h('section', {},
      h('h2', {}, y),
      h('ol', { class: 'event-list' }, ...rs.map((r) => h('li', {},
        h('span', { class: 'date' }, fmtDate(String(r.cols.date))),
        badge(ARENA[String(r.cols.arena)] ?? String(r.cols.arena), `arena arena-${r.cols.arena}`),
        entityLink({ ...r, label: String(r.cols.text ?? r.label) })))))));
}
