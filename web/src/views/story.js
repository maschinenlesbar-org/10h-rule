// Story timeline: one lane per arena. Procedures are bars, events and roll calls are dots, interpretive links
// ("led to") are arcs between lanes. Colors: series 1 (blue) = events and procedures, series 2 (orange) = roll calls,
// series 3 (aqua) = interpretive links — the three slots that validate for all pairs, light and dark.
import { api } from '../api.js?v=e7a98de609';
import { h, setTitle, fmtDate, entityHref, entityLink, markerBadge, readerHref } from '../dom.js?v=e7a98de609';
import { s, withTip, iso } from '../charts/svg.js?v=e7a98de609';
                                         

const RANGES                                  = [['all', '2012-10-01', '2018-07-01'], ['2013', '2013-01-01', '2014-01-01'],
  ['2014', '2014-01-01', '2015-01-01'], ['2015–2016', '2015-01-01', '2016-07-01']];

export async function storyView(params                 )                {
  setTitle('Story');
  const story = await api.story();
  const range = RANGES.find((r) => r[0] === params.get('range')) ?? RANGES[0];
  const chart = h('div', { class: 'viz-scroll' });
  const draw = () => chart.replaceChildren(timeline(story, range[1], range[2], Math.max(760, chart.clientWidth || 1100)));
  requestAnimationFrame(draw);
  let t = 0;
  const onResize = () => { clearTimeout(t); t = window.setTimeout(() => { if (chart.isConnected) draw(); else window.removeEventListener('resize', onResize); }, 150); };
  window.addEventListener('resize', onResize);

  return h('div', { class: 'story viz-root' },
    h('h1', {}, 'The story, arena by arena'),
    h('p', { class: 'lede-small' }, 'From the review order in Bayern (March 2013) through the Bundesrat, the coalition agreement and the federal clause to the Bavarian law and the court ruling. Click any mark to open it.'),
    h('div', { class: 'viz-controls', role: 'group', 'aria-label': 'Time range' },
      ...RANGES.map(([key]) => h('a', { href: `#/story?range=${encodeURIComponent(key)}`, class: 'chip', 'aria-current': key === range[0] ? 'true' : null }, key === 'all' ? 'All years' : key))),
    h('ul', { class: 'viz-legend' },
      h('li', {}, h('span', { class: 'key dot s1' }), 'Event'),
      h('li', {}, h('span', { class: 'key bar s1' }), 'Procedure'),
      h('li', {}, h('span', { class: 'key dot s2' }), 'Roll call'),
      h('li', {}, h('span', { class: 'key line s3' }), 'Interpretive link (led to)')),
    chart,
    h('p', { class: 'muted small' }, 'Same data as a list: ', h('a', { href: '#/list/events' }, 'all events'), '.'),
    linksSection(story),
    proceduresSection(story));
}

function timeline(story       , from        , to        , width        )                {
  const t0 = iso(from), t1 = iso(to);
  const left = 168, right = 24, top = 30;
  const x = (d        ) => left + ((iso(d) - t0) / (t1 - t0)) * (width - left - right);
  const inRange = (d        ) => iso(d) >= t0 && iso(d) <= t1;
  const clampX = (d        ) => Math.min(Math.max(x(d), left), width - right);

  // Lane layout: procedure rows on top, then dot rows placed so dots never overlap.
  const lanes = story.lanes.map((l) => {
    const procs = story.procedures.filter((p) => p.arena === l.id && iso(p.end ?? to) >= t0 && iso(p.start) <= t1);
    const marks = [
      ...story.events.filter((e) => e.arena === l.id && inRange(e.date)).map((e) => ({ kind: 'event'         , id: e.id, date: e.date, label: e.label, ref: e })),
      ...story.votes.filter((v) => v.arena === l.id && inRange(v.date)).map((v) => ({ kind: 'vote'         , id: v.id, date: v.date, label: v.label, ref: v })),
    ].sort((a, b) => iso(a.date) - iso(b.date));
    const rows           = [];
    const placed = marks.map((m) => {
      const mx = x(m.date);
      let r = rows.findIndex((last) => mx - last >= 13);
      if (r < 0) { rows.push(mx); r = rows.length - 1; } else rows[r] = mx;
      return { ...m, cx: mx, row: r };
    });
    return { ...l, procs, placed, height: 22 + procs.length * 22 + Math.max(1, rows.length) * 15 };
  });
  let y = top;
  const laneY = new Map                ();
  for (const l of lanes) { laneY.set(l.id, y); y += l.height; }
  const height = y + 10;

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'timeline', role: 'img', 'aria-label': 'Story timeline by arena' });
  const defs = s('defs', {}, s('marker', { id: 'arrow-s3', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
    s('path', { d: 'M0,1 L9,5 L0,9 z', class: 'fill-s3' })));
  svg.append(defs);

  // Year grid
  for (let yr = new Date(t0).getUTCFullYear(); yr <= new Date(t1).getUTCFullYear() + 1; yr++) {
    const d = `${yr}-01-01`;
    if (!inRange(d)) continue;
    svg.append(s('line', { x1: x(d), x2: x(d), y1: top - 6, y2: height - 6, class: 'grid' }));
    if (x(d) < width - 40) svg.append(s('text', { x: x(d) + 4, y: top - 12, class: 'tick' }, String(yr)));
  }
  // Lanes
  const procY = new Map                ();
  for (const l of lanes) {
    const ly = laneY.get(l.id) ;
    svg.append(s('line', { x1: 0, x2: width, y1: ly, y2: ly, class: 'lane-rule' }), s('text', { x: 4, y: ly + 18, class: 'lane-label' }, l.label));
    l.procs.forEach((p, i) => {
      const py = ly + 14 + i * 22;
      procY.set(p.id, py + 8);
      const x1 = clampX(p.start), x2 = clampX(p.end ?? to);
      const a = s('a', { href: entityHref(p.id), class: 'mark', 'aria-label': `${p.label}, ${fmtDate(p.start)} to ${p.end ? fmtDate(p.end) : 'open'}` });
      const w = Math.max(6, x2 - x1);
      a.append(s('rect', { x: x1, y: py + 4, width: w, height: 8, rx: 4, class: 'fill-s1 proc' }),
        s('rect', { x: x1, y: py - 6, width: w, height: 24, class: 'hit' }));
      withTip(a, `${fmtDate(p.start)} – ${p.end ? fmtDate(p.end) : 'open'}`, p.label, p.status);
      svg.append(a, s('text', { x: x1, y: py, class: 'proc-label' }, p.label.length * 6 > width - x1 - 20 ? p.label.slice(0, Math.max(10, Math.floor((width - x1 - 20) / 6))) + '…' : p.label));
    });
    const dotTop = ly + 16 + l.procs.length * 22;
    for (const m of l.placed) {
      const cy = dotTop + m.row * 15 + 6;
      const a = s('a', { href: entityHref(m.id), class: 'mark', 'aria-label': `${fmtDate(m.date)}: ${m.label}` });
      a.append(s('circle', { cx: m.cx, cy, r: 12, class: 'hit' }),
        s('circle', { cx: m.cx, cy, r: m.kind === 'vote' ? 5.5 : 4.5, class: `dot ${m.kind === 'vote' ? 'fill-s2' : 'fill-s1'}` }));
      if (m.kind === 'vote') {
        const v = m.ref                     ;
        withTip(a, `${v.yes} : ${v.no} : ${v.abstain}`, `${fmtDate(v.date)} · ${v.label}`, 'yes : no : abstained');
      } else withTip(a, fmtDate(m.date), m.label);
      svg.append(a);
      if (m.kind === 'event') procY.set(m.id, cy);
      (m       ).cy = cy;
    }
  }
  // Interpretive links: from the source mark to the start of the target procedure.
  const pos = (id        , atDate         )                          => {
    const p = story.procedures.find((q) => q.id === id);
    if (p && procY.has(id)) {
      const d = atDate && iso(atDate) > iso(p.start) && (!p.end || iso(atDate) < iso(p.end)) ? atDate : atDate && p.end && iso(atDate) >= iso(p.end) ? p.end : p.start;
      return [clampX(d), procY.get(id) ];
    }
    const e = story.events.find((q) => q.id === id);
    if (e && procY.has(id) && inRange(e.date)) return [x(e.date), procY.get(id) ];
    return null;
  };
  for (const l of story.links) {
    const target = story.procedures.find((p) => p.id === l.to);
    const b = pos(l.to);
    const a = pos(l.from, target?.start);
    if (!a || !b) continue;
    const midY = (a[1] + b[1]) / 2;
    const path = s('path', { d: `M${a[0]},${a[1]} C${a[0]},${midY} ${b[0]},${midY} ${b[0]},${b[1] + (b[1] > a[1] ? -6 : 6)}`, class: 'link stroke-s3', 'marker-end': 'url(#arrow-s3)' });
    const g = s('a', { href: `#/story-link`, class: 'mark', tabindex: 0, 'aria-label': `Interpretive link: ${l.fromLabel} led to ${l.toLabel}` }, path,
      s('path', { d: path.getAttribute('d') , class: 'hit-line' }));
    g.addEventListener('click', (ev) => { ev.preventDefault(); document.getElementById(`link-${story.links.indexOf(l)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    withTip(g, 'led to', `${l.fromLabel} → ${l.toLabel}`, l.rationale);
    svg.insertBefore(g, svg.children[1]);
  }
  return svg;
}

function linksSection(story       )       {
  return h('section', {},
    h('h2', {}, 'Interpretive links'),
    h('p', { class: 'muted small' }, 'These links are the research’s reading of cause and effect, not a fact in any single document. Each has a rationale and evidence on a cited page.'),
    h('ol', { class: 'link-list' }, ...story.links.map((l, i) => h('li', { id: `link-${i}` },
      h('div', {}, h('a', { href: entityHref(l.from) }, l.fromLabel), ' → ', h('a', { href: entityHref(l.to) }, l.toLabel), markerBadge(l.marker)),
      h('p', { class: 'rationale' }, l.rationale),
      h('div', { class: 'fact-evidence' }, ...l.evidence.map((ev) => ev.doc_id && ev.file_id && ev.page
        ? h('a', { class: 'evidence', href: readerHref(ev.file_id, ev.page, ev.quote ? { q: ev.quote } : {}) }, `${ev.doc_label ?? ev.doc_id}, p. ${ev.page}`)
        : null))))));
}

function proceduresSection(story       )       {
  return h('section', {},
    h('h2', {}, 'Procedures'),
    h('ul', { class: 'proc-list' }, ...story.procedures.map((p) => h('li', {},
      entityLink({ id: p.id, type: 'Procedure', label: p.label }),
      h('span', { class: 'date' }, ` ${fmtDate(p.start)} – ${p.end ? fmtDate(p.end) : 'open'}`),
      h('span', { class: 'muted small' }, ` · ${p.status}`)))));
}
