// Effects: what the government's own answers say about applications, approvals and commissioning in Bayern.
// One chart per metric (one axis each, never two). Bars span the period each answer reports and are drawn as printed,
// never interpolated; overlapping periods from other answers go to the table. Only values whose quote was found in
// the document are charted.
import { api } from '../api.ts';
import { h, setTitle, entityLink, fmtDate, readerHref, markerBadge } from '../dom.ts';
import { s, withTip, iso } from '../charts/svg.ts';
import type { Observation } from '../types.ts';

const METRIC: Record<string, string> = { applications: 'Applications received', approvals: 'Approvals granted', commissioned: 'Turbines commissioned',
  pending: 'Applications pending', in_operation: 'Turbines in operation', approved_not_built: 'Approved but not built' };
const MARKS: Array<[string, string]> = [['2014-02-04', 'Cut-off date (Vertrauensschutz)'], ['2014-11-21', '10H in force']];

export async function effectsView(): Promise<Node> {
  setTitle('Effects');
  const obs = await api.observations();
  const charted = new Set<string>();
  const groups = new Map<string, Observation[]>();
  // Only values with the same period length share a chart, so bar heights are comparable.
  for (const o of obs.filter((o) => o.verified && o.period_start && o.period_end && o.period_start !== o.period_end && o.place?.id === 'place/bayern')) {
    const g = granularity(o);
    if (!g) continue;
    const k = `${o.metric}|${o.unit}|${g}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const charts: Node[] = [];
  for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    // Greedy non-overlapping series, preferring the document that reports the most periods.
    const docCount = new Map<string, number>();
    for (const o of list) docCount.set(o.doc.id, (docCount.get(o.doc.id) ?? 0) + 1);
    const ordered = [...list].sort((a, b) => (docCount.get(b.doc.id)! - docCount.get(a.doc.id)!) || iso(a.period_start!) - iso(b.period_start!));
    const series: Observation[] = [];
    for (const o of ordered) if (!series.some((x) => iso(o.period_start!) < iso(x.period_end!) && iso(x.period_start!) < iso(o.period_end!))) series.push(o);
    if (series.length < 3) continue;
    series.forEach((o) => charted.add(o.id));
    const [metric, unit, g] = k.split('|');
    charts.push(chart(`${METRIC[metric] ?? metric} in Bayern, per ${g} (${unit})`, series.sort((a, b) => iso(a.period_start!) - iso(b.period_start!))));
  }
  const rest = obs.filter((o) => !charted.has(o.id));
  return h('div', { class: 'effects viz-root' },
    h('h1', {}, 'What 10H did, in the government’s own numbers'),
    h('p', { class: 'lede-small' }, 'Figures from answers of the Bavarian Staatsregierung and the Bundesregierung to parliamentary questions. Each bar covers the period the answer reports and links to the page it is printed on.'),
    charts.length ? charts : h('p', { class: 'muted' }, 'No complete series yet. All figures are in the table below.'),
    h('h2', {}, 'All figures'),
    h('p', { class: 'muted small' }, 'Stock values, overlapping periods and figures for parts of Bayern. Counting bases differ between answers; see the note in each row.'),
    table(rest.length ? rest : obs));
}

function chart(title: string, series: Observation[]): Node {
  const width = 900, height = 270, left = 56, right = 20, top = 40, bottom = 36;
  const start = Math.min(iso('2012-01-01'), ...series.map((o) => iso(o.period_start!)));
  const end = Math.max(iso('2016-12-31'), ...series.map((o) => iso(o.period_end!)));
  const x = (t: number) => left + ((t - start) / (end - start)) * (width - left - right);
  const max = Math.max(...series.map((o) => o.value));
  const step = niceStep(max);
  const yMax = Math.ceil(max / step) * step;
  const y = (v: number) => top + (1 - v / yMax) * (height - top - bottom);
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', class: 'effects-chart', role: 'img', 'aria-label': `${title}: ${series.map((o) => `${fmtDate(o.period_start)}–${fmtDate(o.period_end)}: ${o.value}`).join('; ')}` });
  for (let v = 0; v <= yMax; v += step) svg.append(s('line', { x1: left, x2: width - right, y1: y(v), y2: y(v), class: v === 0 ? 'baseline' : 'grid' }), s('text', { x: left - 8, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' }, String(v)));
  for (let yr = new Date(start).getUTCFullYear(); yr <= new Date(end).getUTCFullYear(); yr++) {
    const t = iso(`${yr}-07-01`);
    if (t > start && t < end) svg.append(s('text', { x: x(t), y: height - bottom + 18, class: 'tick', 'text-anchor': 'middle' }, String(yr)));
  }
  // Labels on two rows (the two dates are only months apart) and on the side with more room.
  MARKS.forEach(([d, label], i) => {
    const lx = x(iso(d));
    const line = s('line', { x1: lx, x2: lx, y1: top - 22 + i * 12, y2: height - bottom, class: 'milestone', tabindex: 0 });
    withTip(line, fmtDate(d), label);
    const leftSide = i === 0;
    svg.append(line, s('text', { x: lx + (leftSide ? -4 : 4), y: top - 24 + i * 12, class: 'milestone-label', 'text-anchor': leftSide ? 'end' : 'start' }, label));
  });
  for (const o of series) {
    const x1 = x(iso(o.period_start!)), x2 = x(iso(o.period_end!) + 864e5);
    const w = Math.max(4, x2 - x1 - 2); // 2px surface gap between adjacent bars
    const h0 = y(0) - y(o.value);
    const a = s('a', { href: o.file_id && o.page ? readerHref(o.file_id, o.page, { q: o.quote }) : `#/e/${o.doc.id}`, class: 'mark', 'aria-label': `${fmtDate(o.period_start)} to ${fmtDate(o.period_end)}: ${o.value} (${o.doc.label})` },
      s('path', { d: `M${x1},${y(0)} v${-Math.max(0, h0 - 4)} a4,4 0 0 1 4,-4 h${Math.max(0, w - 8)} a4,4 0 0 1 4,4 v${Math.max(0, h0 - 4)} z`, class: 'fill-s1 bar' }),
      s('rect', { x: x1, y: top, width: w, height: height - top - bottom, class: 'hit' }));
    withTip(a, String(o.value), `${fmtDate(o.period_start)} – ${fmtDate(o.period_end)}`, `${o.doc.label}${o.page ? `, p. ${o.page}` : ''}. ${o.note}`);
    svg.append(a);
    if (w > 24) svg.append(s('text', { x: x1 + w / 2, y: y(o.value) - 6, class: 'bar-label', 'text-anchor': 'middle' }, String(o.value)));
  }
  return h('figure', { class: 'effects-figure' }, h('figcaption', {}, h('strong', {}, title)), h('div', { class: 'viz-scroll' }, svg),
    h('p', { class: 'muted small' }, 'Sources: ', ...[...new Map(series.map((o) => [o.doc.id, o.doc])).values()].flatMap((d, i) => [i ? ', ' : '', entityLink(d)])));
}

function table(list: Observation[]): Node {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['Figure', 'Value', 'Period', 'Place', 'Source', 'Note'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, ...list.map((o) => h('tr', {},
      h('td', {}, METRIC[o.metric] ?? o.metric), h('td', { class: 'num' }, `${o.value} ${o.unit === 'MW' ? 'MW' : ''}`),
      h('td', {}, o.period_start === o.period_end ? `at ${fmtDate(o.period_start)}` : `${fmtDate(o.period_start)} – ${fmtDate(o.period_end)}`),
      h('td', {}, o.place ? entityLink(o.place) : ''),
      h('td', {}, o.file_id && o.page ? h('a', { href: readerHref(o.file_id, o.page, { q: o.quote }) }, `${o.doc.label}, p. ${o.page}`) : entityLink(o.doc),
        o.verified ? null : markerBadge('unverified')),
      h('td', { class: 'small' }, o.note))))));
}

function granularity(o: Observation): 'month' | 'quarter' | 'year' | null {
  const days = (iso(o.period_end!) - iso(o.period_start!)) / 864e5 + 1;
  if (days >= 28 && days <= 31) return 'month';
  if (days >= 89 && days <= 92) return 'quarter';
  if (days >= 365 && days <= 366) return 'year';
  return null;
}

function niceStep(max: number): number {
  const raw = max / 5, p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
}
