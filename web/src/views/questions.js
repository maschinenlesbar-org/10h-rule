// Questions: who asked whom (matrix) and when (strip per parliament, with the story's milestones).
// Matrix = HTML table shaded with a validated sequential ramp (5 bins); the counts are printed in every cell.
import { api } from '../api.js?v=e7a98de609';
import { h, setTitle, entityLink, fmtDate, entityHref } from '../dom.js?v=e7a98de609';
import { s, withTip, iso } from '../charts/svg.js?v=e7a98de609';
                                               

const PARL                         = { bt: 'Bundestag', by: 'Bayerischer Landtag', sn: 'Sächsischer Landtag', mv: 'Landtag MV' };
const MILESTONES                          = [['2013-07-02', 'BR-Drs 569/13'], ['2013-11-27', 'Coalition agreement'], ['2014-02-04', 'BY cabinet: 10H'],
  ['2014-06-27', 'Bundestag vote'], ['2014-11-21', '10H in force'], ['2015-12-31', 'Deadline']];
const bin = (n        ) => (n >= 9 ? 5 : n >= 5 ? 4 : n >= 3 ? 3 : n >= 2 ? 2 : 1);

export async function questionsView(params                 )                {
  setTitle('Questions');
  const all = await api.questions();
  const parl = params.get('parl') ?? '';
  const rows = parl ? all.filter((q) => q.parliament === parl) : all;
  const parls = [...new Set(all.map((q) => q.parliament).filter(Boolean))]            ;

  return h('div', { class: 'questions viz-root' },
    h('h1', {}, 'Who asked whom'),
    h('p', { class: 'lede-small' }, 'Parliamentary questions on wind turbine distances and 10H, 2012–2016: the asker’s party against the office that answered. Each question counts once per asker.'),
    h('div', { class: 'viz-controls', role: 'group', 'aria-label': 'Parliament' },
      h('a', { class: 'chip', href: '#/questions', 'aria-current': parl ? null : 'true' }, `All (${all.length})`),
      ...parls.map((p) => h('a', { class: 'chip', href: `#/questions?parl=${p}`, 'aria-current': parl === p ? 'true' : null }, `${PARL[p] ?? p} (${all.filter((q) => q.parliament === p).length})`))),
    matrix(rows),
    h('h2', {}, 'When the questions were asked'),
    strip(all, parl),
    h('details', { class: 'table-view' }, h('summary', {}, `All ${rows.length} questions as a table`), table(rows)));
}

function matrix(rows               )       {
  const parties = [...new Set(rows.map((r) => r.party ?? 'party unknown'))].sort((a, b) => count(rows, (r) => (r.party ?? 'party unknown') === b) - count(rows, (r) => (r.party ?? 'party unknown') === a));
  const answerers = new Map                                                                           ();
  for (const r of rows) {
    const key = r.answerer?.id ?? 'none';
    if (!answerers.has(key)) answerers.set(key, r.answerer ? { label: r.answerer.label, short: r.answerer.short, id: r.answerer.id, kind: r.answerer.kind } : { label: 'Answerer not recorded', short: 'not recorded', id: null, kind: 'none' });
  }
  const cols = [...answerers].sort((a, b) => (a[1].kind === 'none' ? 1 : b[1].kind === 'none' ? -1 : count(rows, (r) => (r.answerer?.id ?? 'none') === b[0]) - count(rows, (r) => (r.answerer?.id ?? 'none') === a[0])));
  return h('div', { class: 'table-wrap' }, h('table', { class: 'heat' },
    h('caption', { class: 'muted small' }, 'Rows: party of the asker. Columns: the person or ministry that answered. Darker = more questions.'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Asker’s party'),
      ...cols.map(([, a]) => h('th', { scope: 'col', class: 'num', title: a.label }, a.id ? h('a', { href: entityHref(a.id) }, a.short) : a.short)),
      h('th', { scope: 'col', class: 'num' }, 'Total'))),
    h('tbody', {}, ...parties.map((p) => {
      const mine = rows.filter((r) => (r.party ?? 'party unknown') === p);
      return h('tr', {}, h('th', { scope: 'row' }, p),
        ...cols.map(([key, a]) => {
          const n = count(mine, (r) => (r.answerer?.id ?? 'none') === key);
          const td = h('td', { class: n ? `num q${bin(n)}` : 'num zero', tabindex: n ? 0 : null }, n ? String(n) : '');
          if (n) withTip(td, String(n), `${p} → ${a.label}`);
          return td;
        }),
        h('td', { class: 'num total' }, String(mine.length)));
    }))));
}

function strip(all               , parl        )       {
  const width = 1000, left = 178, right = 20, top = 34;
  const t0 = iso('2012-07-01'), t1 = iso('2016-12-31');
  const x = (d        ) => left + ((iso(d) - t0) / (t1 - t0)) * (width - left - right);
  const lanes = (parl ? [parl] : ['bt', 'by', 'sn']).filter((p) => all.some((q) => q.parliament === p));
  // Place dots in rows so they never overlap; each lane is as tall as it needs.
  const placed = new Map                                                            ();
  for (const p of lanes) {
    const rows           = [];
    placed.set(p, all.filter((q) => q.parliament === p && q.date).sort((a, b) => iso(a.date ) - iso(b.date )).map((q) => {
      const cx = x(q.date );
      let r = rows.findIndex((last) => cx - last >= 9);
      if (r < 0) { rows.push(cx); r = rows.length - 1; } else rows[r] = cx;
      return { q, cx, row: r };
    }));
  }
  const laneH = (p        ) => Math.max(40, 22 + (Math.max(0, ...placed.get(p) .map((d) => d.row)) + 1) * 9);
  const laneY = new Map                ();
  let yy = top;
  for (const p of lanes) { laneY.set(p, yy); yy += laneH(p); }
  const height = yy + 10;
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', class: 'timeline strip', role: 'img', 'aria-label': 'Questions over time by parliament' });
  for (let y = 2013; y <= 2016; y++) svg.append(s('line', { x1: x(`${y}-01-01`), x2: x(`${y}-01-01`), y1: top - 4, y2: height - 6, class: 'grid' }), s('text', { x: x(`${y}-01-01`) + 4, y: top - 20, class: 'tick' }, String(y)));
  MILESTONES.forEach(([d, label], i) => {
    const line = s('line', { x1: x(d), x2: x(d), y1: top - 4, y2: height - 6, class: 'milestone', tabindex: 0 });
    withTip(line, fmtDate(d), label);
    svg.append(line, s('text', { x: x(d), y: top - 6, class: 'milestone-num', 'text-anchor': 'middle' }, String(i + 1)));
  });
  for (const p of lanes) {
    const ly = laneY.get(p) ;
    svg.append(s('line', { x1: 0, x2: width, y1: ly, y2: ly, class: 'lane-rule' }), s('text', { x: 4, y: ly + 18, class: 'lane-label' }, PARL[p] ?? p));
    for (const { q, cx, row } of placed.get(p) ) {
      const cy = ly + 12 + row * 9;
      const a = s('a', { href: entityHref(q.doc.id), class: 'mark', 'aria-label': `${fmtDate(q.date)}: ${q.asker.label} (${q.party ?? '?'}), ${q.doc.label}` },
        s('circle', { cx, cy, r: 9, class: 'hit' }), s('circle', { cx, cy, r: 3.5, class: 'dot fill-s1' }));
      withTip(a, fmtDate(q.date), `${q.asker.label} (${q.party ?? 'party unknown'})`, `${q.doc.label}${q.label ? ` · ${q.label}` : ''}${q.answerer ? ` · answered by ${q.answerer.short}` : ''}`);
      svg.append(a);
    }
  }
  return h('div', {},
    h('div', { class: 'viz-scroll' }, svg),
    h('ul', { class: 'viz-legend' }, h('li', {}, h('span', { class: 'key dot s1' }), 'Question (one per asker)'),
      h('li', {}, h('span', { class: 'key line milestone-key' }), 'Milestones: ', MILESTONES.map(([d, l], i) => `${i + 1} ${l} (${fmtDate(d)})`).join(' · '))));
}

function table(rows               )       {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['Date', 'Parliament', 'Asker', 'Party', 'Document', 'Answered by'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, fmtDate(r.date)), h('td', {}, PARL[r.parliament ?? ''] ?? r.parliament ?? ''),
      h('td', {}, entityLink(r.asker)), h('td', {}, r.party ?? ''), h('td', {}, entityLink(r.doc), r.label ? ` · ${r.label}` : ''),
      h('td', {}, r.answerer ? entityLink({ id: r.answerer.id, type: r.answerer.type, label: r.answerer.label }) : '—'))))));
}

const count =     (xs     , f                   ) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
