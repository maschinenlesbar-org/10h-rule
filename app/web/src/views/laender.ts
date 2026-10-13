// Länder status: tile grid map (equal tiles, so Bayern does not dominate by area). Status uses series 1–3 (validated
// for all pairs) plus neutral gray for "no record"; every tile carries its name, and the table repeats everything.
import { api } from '../api.ts';
import { h, setTitle, entityLink, markerBadge } from '../dom.ts';
import { withTip } from '../charts/svg.ts';

const GRID: Record<string, [number, number, string, string]> = {
  'place/schleswig-holstein': [2, 0, 'SH', 'Schleswig-Holstein'], 'place/bremen': [1, 1, 'HB', 'Bremen'], 'place/hamburg': [2, 1, 'HH', 'Hamburg'], 'place/mecklenburg-vorpommern': [3, 1, 'MV', 'Mecklenburg-Vorpommern'],
  'place/nordrhein-westfalen': [0, 2, 'NW', 'Nordrhein-Westfalen'], 'place/niedersachsen': [1, 2, 'NI', 'Niedersachsen'], 'place/sachsen-anhalt': [2, 2, 'ST', 'Sachsen-Anhalt'], 'place/berlin': [3, 2, 'BE', 'Berlin'], 'place/brandenburg': [4, 2, 'BB', 'Brandenburg'],
  'place/rheinland-pfalz': [0, 3, 'RP', 'Rheinland-Pfalz'], 'place/hessen': [1, 3, 'HE', 'Hessen'], 'place/thueringen': [2, 3, 'TH', 'Thüringen'], 'place/sachsen': [3, 3, 'SN', 'Sachsen'],
  'place/saarland': [0, 4, 'SL', 'Saarland'], 'place/baden-wuerttemberg': [1, 4, 'BW', 'Baden-Württemberg'], 'place/bayern': [2, 4, 'BY', 'Bayern'],
};
const STATUS: Record<string, [string, string]> = { used: ['Used the clause (Landesgesetz)', 's1'], considered: ['Announced or prepared, then dropped', 's2'],
  debated: ['Debated (motions, bills, initiatives)', 's3'], no_record: ['No record in this research', 'neutral'] };

export async function laenderView(): Promise<Node> {
  setTitle('Länder');
  const list = await api.laender();
  const by = new Map(list.map((l) => [l.land.id, l]));
  const tiles = Object.entries(GRID).map(([id, [c, r, abbr, name]]) => {
    const l = by.get(id);
    const label = l?.land.label ?? name;
    const st = STATUS[l?.status ?? 'no_record'] ?? STATUS.no_record;
    const tile = h('a', { href: `#/e/${id}`, class: `tile tile-${st[1]}`, style: `grid-column: ${c + 1}; grid-row: ${r + 1}`, 'aria-label': `${label}: ${st[0]}` },
      h('span', { class: 'abbr' }, abbr), h('span', { class: 'name' }, label));
    withTip(tile, st[0], label, l?.summary);
    return tile;
  });
  return h('div', { class: 'laender viz-root' },
    h('h1', {}, 'Which Länder used the clause?'),
    h('p', { class: 'lede-small' }, '§ 249 Abs. 3 BauGB let every Land set distances by Landesgesetz until 31.12.2015. One Land did.'),
    h('ul', { class: 'viz-legend' }, ...Object.values(STATUS).map(([label, cls]) => h('li', {}, h('span', { class: `key bar ${cls}` }), label))),
    h('div', { class: 'tilemap', role: 'list' }, ...tiles),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ...['Land', 'Status', 'What happened', 'Source'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, ...list.sort((a, b) => order(a.status) - order(b.status) || a.land.label.localeCompare(b.land.label)).map((l) => h('tr', {},
        h('th', { scope: 'row' }, entityLink(l.land)), h('td', {}, (STATUS[l.status] ?? STATUS.no_record)[0]),
        h('td', {}, l.summary, markerBadge(l.marker)), h('td', { class: 'small' }, l.doc ? entityLink(l.doc) : null, l.doc ? ' · ' : '', l.source.split('|').join(', '))))))));
}

const order = (s: string) => ['used', 'considered', 'debated', 'no_record'].indexOf(s);
