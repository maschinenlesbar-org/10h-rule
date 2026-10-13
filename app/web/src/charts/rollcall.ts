// Roll call: one horizontal stacked bar per Fraktion. Order yes / no / abstained (series 1–3, validated as adjacent
// pairs) and "not voted" in neutral gray. Counts are direct labels where they fit; the table view carries all values.
import { h, entityLink } from '../dom.ts';
import { s, withTip } from './svg.ts';
import type { RollCallView, RollCallMember } from '../types.ts';

const OPTIONS: Array<{ key: 'yes' | 'no' | 'abstain' | 'not_voted'; label: string; cls: string }> = [
  { key: 'yes', label: 'Yes', cls: 's1' }, { key: 'no', label: 'No', cls: 's2' },
  { key: 'abstain', label: 'Abstained', cls: 's3' }, { key: 'not_voted', label: 'Not voted', cls: 'neutral' },
];
const OPTION_LABEL: Record<string, string> = { yes: 'yes', no: 'no', abstain: 'abstained', not_voted: 'not voted' };

export function rollcallSection(rc: RollCallView): Node {
  const opts = OPTIONS.filter((o) => rc.groups.some((g) => g[o.key] > 0)); // options nobody chose are left out
  const width = 640, barH = 20, left = 0;
  const max = Math.max(...rc.groups.map((g) => opts.reduce((n, o) => n + g[o.key], 0)));
  const scale = (n: number) => (n / max) * (width - 60);

  const rows = rc.groups.map((g) => {
    const svg = s('svg', { viewBox: `0 0 ${width} ${barH}`, width: '100%', height: barH, class: 'rc-bar', preserveAspectRatio: 'xMinYMid meet', role: 'img',
      'aria-label': `${g.group}: ${opts.map((o) => `${g[o.key]} ${OPTION_LABEL[o.key]}`).join(', ')}` });
    let xPos = left;
    const segs = opts.filter((o) => g[o.key] > 0);
    segs.forEach((o, i) => {
      const w = scale(g[o.key]);
      const last = i === segs.length - 1;
      const segW = Math.max(1, w - (last ? 0 : 2)); // 2px surface gap between segments
      // Rounded data end only on the last segment, square at the baseline.
      const shape = last
        ? s('path', { d: `M${xPos},0 h${Math.max(0, segW - 4)} a4,4 0 0 1 4,4 v${barH - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, segW - 4)} z`, class: `fill-${o.cls}` })
        : s('rect', { x: xPos, y: 0, width: segW, height: barH, class: `fill-${o.cls}` });
      const seg = s('g', { tabindex: 0, class: 'mark seg' }, shape);
      const text = String(g[o.key]);
      if (segW >= text.length * 7 + 10) seg.append(s('text', { x: xPos + segW / 2, y: barH / 2 + 4, class: `seg-label on-${o.cls}`, 'text-anchor': 'middle' }, text));
      withTip(seg, text, `${g.group} · ${OPTION_LABEL[o.key]}`);
      svg.append(seg);
      xPos += w;
    });
    const total = opts.reduce((n, o) => n + g[o.key], 0);
    svg.append(s('text', { x: xPos + 6, y: barH / 2 + 4, class: 'tick' }, String(total)));
    return h('div', { class: 'rc-row' }, h('div', { class: 'rc-label' }, g.group), svg);
  });

  const memberRow = (m: RollCallMember) => h('tr', {},
    h('th', { scope: 'row' }, m.person ? entityLink(m.person) : m.name),
    h('td', {}, m.group ?? '—', m.group_source && m.group_source !== 'protocol' ? h('span', { class: 'muted small' }, ` (${m.group_source})`) : null),
    h('td', {}, OPTION_LABEL[m.option]), h('td', { class: 'num' }, m.page ? String(m.page) : ''));

  return h('section', { class: 'rollcall viz-root' },
    h('h2', {}, 'How each Fraktion voted'),
    h('ul', { class: 'viz-legend' }, ...opts.map((o) => h('li', {}, h('span', { class: `key bar ${o.cls}` }), o.label))),
    h('div', { class: 'rc-chart' }, ...rows),
    rc.groups.some((g) => g.group === 'Fraktion unknown')
      ? h('p', { class: 'muted small' }, '“Fraktion unknown”: members without a documented Fraktion on the vote date in the sources used (wiki profiles, abgeordnetenwatch.de).') : null,
    rc.hasNotVoted ? h('p', { class: 'muted small' }, '“Not voted”: listed in the protocol’s Abstimmungsliste without a mark.') : null,
    h('details', { class: 'table-view' }, h('summary', {}, 'Table view'),
      h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Fraktion'), ...opts.map((o) => h('th', { class: 'num' }, o.label)))),
        h('tbody', {}, ...rc.groups.map((g) => h('tr', {}, h('th', { scope: 'row' }, g.group), ...opts.map((o) => h('td', { class: 'num' }, String(g[o.key])))))))),
    h('h3', {}, `Voted against their Fraktion's majority (${rc.deviators.length})`),
    rc.deviators.length
      ? h('ul', { class: 'deviators' }, ...rc.deviators.map((d) => h('li', {}, d.person ? entityLink(d.person) : d.name, ` (${d.group}): ${OPTION_LABEL[d.option]}, majority ${OPTION_LABEL[d.majority]}`)))
      : h('p', { class: 'muted' }, 'Nobody.'),
    h('details', {}, h('summary', {}, `All ${rc.members.length} names in the list`),
      h('p', { class: 'muted small' }, `From ${rc.file ?? 'the protocol'}, PDF pages ${rc.pages.join(', ')}. People with an entry in this database are linked.`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Fraktion'), h('th', {}, 'Vote'), h('th', { class: 'num' }, 'PDF page'))),
        h('tbody', {}, ...rc.members.map(memberRow))))));
}
