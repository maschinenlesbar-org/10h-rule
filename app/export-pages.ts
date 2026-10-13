// Static pages for the export: one plain HTML page per entity at e/<id>/, an index of all entries at e/, the
// bibliography at bibliography/, and sitemap.xml. The app itself lives behind #/ routes that search engines and link
// previews cannot see; these pages carry the same facts as real URLs, with a description, Open Graph tags and the
// entity's JSON-LD, and link back into the app for search, the reader and the charts. They work without JavaScript.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Queries } from './server/queries.ts';
import type { EntityPage, Fact, Evidence, BibEntry } from './web/src/types.ts';
import { groupFacts } from './web/src/facts.ts';

const TYPE_LABEL: Record<string, string> = { Person: 'Person', Organization: 'Organisation', Document: 'Document', Law: 'Law', Concept: 'Concept',
  Place: 'Place', Event: 'Event', VoteEvent: 'Roll call', Procedure: 'Procedure' };
const TYPE_PLURAL: Record<string, string> = { Event: 'Events', Procedure: 'Procedures', VoteEvent: 'Roll calls', Person: 'People', Document: 'Documents',
  Organization: 'Organisations', Place: 'Places', Concept: 'Concepts', Law: 'Laws and provisions' };
const ARENA: Record<string, string> = { bt: 'Bundestag', br: 'Bundesrat', by: 'Bayern', sn: 'Sachsen', bund: 'Bund', 'bund-government': 'Bundesregierung' };
const SITE_NAME = '10H Explorer';
const MAX_MENTIONS = 200;

interface Ctx { site: string; dist: string; builtAt: string; jsonld: Map<string, unknown>; context: unknown }

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d ? `${d}.${m}.${y}` : m ? `${m}/${y}` : y;
};
const fmtBytes = (n: number | null | undefined): string =>
  !n ? '' : n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, s.lastIndexOf(' ', n - 1))} …` : s);
const fileHref = (rel: string, id: string) => `${rel}files/${id.split('/').map(encodeURIComponent).join('/')}`;
export const pagePath = (id: string) => `e/${id}/`;

export function writeStaticPages(q: Queries, entities: Array<{ id: string; type: string; label: string }>, ctx: Ctx): number {
  for (const ent of entities) {
    const page = q.entity(ent.id);
    if (!page) continue;
    const dir = join(ctx.dist, pagePath(ent.id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), entityPage(page, ctx));
  }
  writeFileSync(join(ctx.dist, 'e', 'index.html'), indexPage(entities, ctx));
  mkdirSync(join(ctx.dist, 'bibliography'), { recursive: true });
  writeFileSync(join(ctx.dist, 'bibliography', 'index.html'), bibliographyPage(q.bibliography(), ctx));
  writeFileSync(join(ctx.dist, 'sitemap.xml'), sitemap(entities, ctx));
  return entities.length;
}

function entityPage(p: EntityPage, ctx: Ctx): string {
  const e = p.entity;
  const rel = '../'.repeat(1 + e.id.split('/').length);
  const link = (x: { id: string; label: string }) => `<a href="${rel}${pagePath(x.id)}">${esc(x.label)}</a>`;
  const props = e.props as Record<string, any>;
  const node = ctx.jsonld.get(e.id);
  const body = [
    `<p class="eyebrow">${esc(TYPE_LABEL[e.type] ?? e.type)}${props.classification ? ` · ${esc(props.classification.replace(/_/g, ' '))}` : ''}</p>`,
    `<h1>${esc(e.label)}</h1>`,
    p.aliases.length ? `<p class="muted small">Also: ${p.aliases.slice(0, 12).map(esc).join(' · ')}</p>` : '',
    props.description ? `<p>${esc(props.description)}</p>` : '',
    p.external.filter((x) => x.url).length
      ? `<p class="ids">${p.external.filter((x) => x.url).map((x) => `<a class="id-chip" href="${esc(x.url)}" rel="noopener">${esc(x.scheme)} ${esc(x.value)}</a>`).join('')}</p>` : '',
    `<p class="static-note">This is the plain page of this entry. <a href="${rel}#/e/${esc(e.id)}">Open it in the explorer</a> for search, the document reader and the charts.</p>`,
    documentPanel(p, rel),
    eventPanel(p),
    procedurePanel(p, link),
    rollcallPanel(p, link),
    factsSection(p, rel, link),
    worksSection(p, rel),
    mentionsSection(p, link),
  ].join('\n');
  return shell({
    rel, ctx, title: e.label, url: `${ctx.site}${pagePath(e.id)}`, description: describe(p), body,
    jsonld: node ? { '@context': ctx.context, ...(node as object) } : null, ogType: 'article',
  });
}

function documentPanel(p: EntityPage, rel: string): string {
  const d = p.document;
  if (!d) return '';
  const row = (k: string, v: string | null | undefined) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : '');
  const files = d.archived
    ? `<ul class="files">${d.files.map((f) => `<li><a class="button" href="${fileHref(rel, f.id)}">PDF${f.part ? ` (${esc(f.part)})` : ''}</a> `
      + `<a href="${rel}#/read?${new URLSearchParams({ file: f.id, n: '1' })}">Read with linked text</a>`
      + `<span class="muted small"> ${[`${f.pages} pages`, fmtBytes(f.bytes)].filter(Boolean).join(' · ')}</span></li>`).join('')}</ul>`
    : '<p class="muted">Not in the archive. Cited by archived documents; the source link opens the original.</p>';
  return `<section class="doc-panel"><dl class="meta-grid">${row('Type', esc(d.kind))}${row('Number', esc(d.number))}${row('Date', fmtDate(d.date))}`
    + `${row('Issuer', esc(d.issuer))}${row('Title', esc(d.title))}`
    + `${row('Source', d.source_url ? `<a href="${esc(d.source_url)}" rel="noopener">${esc(new URL(d.source_url).host)}</a>` : null)}</dl>${files}</section>`;
}

function eventPanel(p: EntityPage): string {
  if (p.entity.type !== 'Event') return '';
  const x = p.entity.props as Record<string, any>;
  return `<section class="doc-panel"><dl class="meta-grid"><dt>Date</dt><dd>${fmtDate(x.date)}${x.end ? `–${fmtDate(x.end)}` : ''}</dd>`
    + `<dt>Arena</dt><dd>${esc(ARENA[x.arena] ?? x.arena)}</dd>${x.body ? `<dt>Body</dt><dd>${esc(x.body)}</dd>` : ''}</dl><p>${esc(x.text)}</p></section>`;
}

function procedurePanel(p: EntityPage, link: (x: { id: string; label: string }) => string): string {
  const pr = p.procedure;
  if (!pr) return '';
  return `<section class="procedure"><dl class="meta-grid"><dt>Period</dt><dd>${fmtDate(pr.start)} – ${pr.end ? fmtDate(pr.end) : 'open'}</dd>`
    + `<dt>Status</dt><dd>${esc(pr.status)}</dd></dl>${pr.description ? `<p>${esc(pr.description)}</p>` : ''}<h2>Steps</h2><ol class="steps">`
    + pr.steps.map((st) => `<li><span class="step-date">${fmtDate(st.date)}${st.end ? `–${fmtDate(st.end)}` : ''}</span><div class="step-body">`
      + `${st.body ? `<span class="badge arena">${esc(st.body)}</span> ` : ''}${st.event ? link({ id: st.event.id, label: st.text }) : esc(st.text)}`
      + `${st.docs.length ? `<div class="chips step-docs">${st.docs.map(link).join(' ')}</div>` : ''}</div></li>`).join('')
    + '</ol></section>';
}

function rollcallPanel(p: EntityPage, link: (x: { id: string; label: string }) => string): string {
  const rc = p.rollcall;
  if (!rc) return '';
  const total = (k: 'yes' | 'no' | 'abstain' | 'not_voted') => rc.groups.reduce((a, g) => a + g[k], 0);
  return `<section><h2>Votes by group</h2><div class="table-wrap"><table><thead><tr><th scope="col">Group</th><th class="num" scope="col">Yes</th>`
    + `<th class="num" scope="col">No</th><th class="num" scope="col">Abstained</th>${rc.hasNotVoted ? '<th class="num" scope="col">Did not vote</th>' : ''}</tr></thead><tbody>`
    + rc.groups.map((g) => `<tr><th scope="row">${esc(g.group)}</th><td class="num">${g.yes}</td><td class="num">${g.no}</td><td class="num">${g.abstain}</td>`
      + `${rc.hasNotVoted ? `<td class="num">${g.not_voted}</td>` : ''}</tr>`).join('')
    + `<tr><th scope="row">Total</th><td class="num">${total('yes')}</td><td class="num">${total('no')}</td><td class="num">${total('abstain')}</td>`
    + `${rc.hasNotVoted ? `<td class="num">${total('not_voted')}</td>` : ''}</tr></tbody></table></div>`
    + (rc.deviators.length ? `<h3>Voted against their group’s majority</h3><ul class="deviators">${rc.deviators.map((d) => `<li>${d.person ? link({ id: d.person.id, label: d.name }) : esc(d.name)} (${esc(d.group)}): ${esc(d.option)}, majority ${esc(d.majority)}</li>`).join('')}</ul>` : '')
    + '</section>';
}

function evidenceLink(ev: Evidence, rel: string): string {
  if (!ev.doc_id) return '';
  const label = `${esc(ev.doc_label ?? ev.doc_id)}${ev.page ? `, p. ${ev.page}` : ev.locator ? `, ${esc(ev.locator)}` : ''}`;
  const href = ev.file_id && ev.page ? `${fileHref(rel, ev.file_id)}#page=${ev.page}` : `${rel}${pagePath(ev.doc_id)}`;
  return `<a class="evidence${ev.read_via === 'ocr' ? ' ocr' : ''}" href="${href}"${ev.quote ? ` title="“${esc(ev.quote)}”"` : ''}>${label}${ev.read_via === 'ocr' ? ' · OCR' : ''}</a>`;
}

function factRow(f: Fact, rel: string, link: (x: { id: string; label: string }) => string): string {
  const date = f.start ? fmtDate(f.start) + (f.end ? `–${fmtDate(f.end)}` : '') : '';
  const marker = f.marker === 'secondary' ? ' <span class="badge marker-secondary">secondary</span>'
    : f.marker === 'unverified' ? ' <span class="badge marker-unverified">not verified</span>' : '';
  const evidence = f.evidence.filter((ev) => ev.page || ev.quote || ev.doc_id !== f.other?.id).slice(0, 3).map((ev) => evidenceLink(ev, rel)).filter(Boolean);
  return `<li class="fact${f.interpretive ? ' interpretive' : ''}"><div class="fact-main">${f.other ? link(f.other) : ''}`
    + `${f.value ? `<span class="value">${f.other ? ' · ' : ''}${esc(f.value)}</span>` : ''}${date ? `<span class="date">${date}</span>` : ''}${marker}`
    + `${f.interpretive ? ' <span class="badge interpretive">interpretation</span>' : ''}</div>`
    + `${f.rationale ? `<p class="rationale">${esc(f.rationale)}</p>` : ''}`
    + `${evidence.length ? `<div class="fact-evidence">${evidence.join(' ')}${f.evidence.length > 3 ? `<span class="muted small"> +${f.evidence.length - 3} more</span>` : ''}</div>` : ''}</li>`;
}

function factsSection(p: EntityPage, rel: string, link: (x: { id: string; label: string }) => string): string {
  const facts = p.procedure ? p.facts.filter((f) => !(f.pred === 'part_of' && f.direction === 'in')) : p.facts;
  if (!facts.length) return '';
  return `<section class="facts"><h2>Facts and links</h2>${groupFacts(facts).map(({ label, facts: fs }) =>
    `<div class="fact-group"><h3>${esc(label)}<span class="count">${fs.length}</span></h3><ul class="fact-list">${fs.map((f) => factRow(f, rel, link)).join('')}</ul></div>`).join('')}</section>`;
}

function worksSection(p: EntityPage, rel: string): string {
  if (!p.works?.length) return '';
  return `<section class="works"><h2>Works cited<span class="count">${p.works.length}</span></h2>`
    + `<p class="muted small">Outside the archive, found by pattern in the text. <a href="${rel}bibliography/">The whole bibliography</a></p><ul class="fact-list">`
    + p.works.map((w) => `<li class="fact">${w.url ? `<a href="${esc(w.url)}" rel="noopener">${esc(w.label)}</a>` : esc(w.label)}`
      + `<div class="fact-evidence">${w.pages.map((n) => `<a class="evidence" href="${fileHref(rel, w.file_id)}#page=${n}">p. ${n}</a>`).join(' ')}</div></li>`).join('')
    + '</ul></section>';
}

// The bibliography as a plain page: citations on pages about wind power only, as the app shows by default.
const BIB_KINDS: Array<[string, string]> = [['parliamentary', 'Parliamentary documents'], ['court', 'Court decisions'], ['legislation', 'Legislation'],
  ['literature', 'Literature'], ['web', 'Web sources']];
function bibliographyPage(all: BibEntry[], ctx: Ctx): string {
  const rel = '../';
  const entries = all.map((e) => ({ ...e, citations: e.citations.filter((c) => c.on_topic) })).filter((e) => e.citations.length);
  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const body = '<h1>Bibliography</h1><p class="lede-small">The works outside the archive that the archived documents cite on pages about wind power. '
    + `Found by pattern in the full text and not reviewed. <a href="${rel}#/bibliography">The explorer</a> has filters, all citations and a CSV download.</p>`
    + BIB_KINDS.map(([k, title]) => {
      const group = entries.filter((e) => e.kind === k).sort((a, b) => collator.compare(a.label, b.label));
      if (!group.length) return '';
      return `<section class="bib-group"><h2>${title}<span class="count">${group.length}</span></h2><ol class="bib-entries">`
        + group.map((e) => {
          const label = e.entity ? `<a href="${rel}${pagePath(e.entity.id)}">${esc(e.label)}</a>`
            : e.url ? `<a class="bib-url" href="${esc(e.url)}" rel="noopener">${esc(e.label)}</a>` : esc(e.label);
          const docs = [...new Map(e.citations.map((c) => [c.doc.id, c.doc])).values()];
          return `<li class="bib-entry">${label}<span class="muted small"> · cited in ${docs.map((d) => `<a href="${rel}${pagePath(d.id)}">${esc(d.label)}</a>`).join(', ')}</span></li>`;
        }).join('') + '</ol></section>';
    }).join('');
  return shell({ rel, ctx, title: 'Bibliography', url: `${ctx.site}bibliography/`, ogType: 'website', jsonld: null, body,
    description: `${entries.length} works cited in the record of how Bayern got the 10H rule: parliamentary documents, court decisions, legislation, literature and web sources.` });
}

function mentionsSection(p: EntityPage, link: (x: { id: string; label: string }) => string): string {
  if (!p.mentionedIn.length) return '';
  const shown = p.mentionedIn.slice(0, MAX_MENTIONS);
  return `<section class="mentions"><h2>Mentioned in<span class="count">${p.mentionTotal} mentions</span></h2><ul class="mention-list">`
    + shown.map((m) => `<li>${link(m.doc)}<span class="count">${m.n}</span>${m.status === 'auto' ? ' <span class="badge marker-unverified">unreviewed</span>' : ''}</li>`).join('')
    + `</ul>${p.mentionedIn.length > shown.length ? `<p class="muted small">and ${p.mentionedIn.length - shown.length} more documents.</p>` : ''}</section>`;
}

// One or two sentences for search results and link previews.
function describe(p: EntityPage): string {
  const e = p.entity;
  const x = e.props as Record<string, any>;
  const tail = 'From the record of how Bayern got the 10H rule for wind turbines.';
  if (p.document) {
    const d = p.document;
    const head = [d.kind, d.date ? `of ${fmtDate(d.date)}` : ''].filter(Boolean).join(' ');
    return clip(`${e.label}${head ? `, ${head}` : ''}${d.title && d.title !== e.label ? `: ${d.title}` : ''}. ${tail}`, 220);
  }
  if (e.type === 'Event') return clip(`${fmtDate(x.date)}: ${x.text ?? e.label} ${tail}`, 220);
  if (p.procedure?.description) return clip(`${p.procedure.description} ${tail}`, 220);
  if (x.description) return clip(`${e.label}: ${x.description}. ${tail}`, 220);
  const party = p.facts.find((f) => f.pred === 'member_of' && f.direction === 'out' && f.other)?.other?.label;
  const docs = p.mentionedIn.length;
  return clip(`${e.label}${party ? ` (${party})` : ''}: ${(TYPE_LABEL[e.type] ?? e.type).toLowerCase()} in the record of how Bayern got the 10H rule for wind turbines, `
    + `with ${p.facts.length} sourced ${p.facts.length === 1 ? 'fact' : 'facts'}${docs ? ` and mentions in ${docs} ${docs === 1 ? 'document' : 'documents'}` : ''}.`, 220);
}

function indexPage(entities: Array<{ id: string; type: string; label: string }>, ctx: Ctx): string {
  const rel = '../';
  const byType = new Map<string, typeof entities>();
  for (const e of entities) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  const body = '<h1>All entries</h1><p class="lede-small">Every person, document, event, law and concept of the record as a plain page. '
    + `<a href="${rel}">The explorer</a> has search, the timeline and the charts.</p>`
    + Object.keys(TYPE_PLURAL).filter((t) => byType.has(t)).map((t) => {
      const list = byType.get(t)!.sort((a, b) => a.label.localeCompare(b.label, 'de'));
      return `<section><h2>${TYPE_PLURAL[t]}<span class="count">${list.length}</span></h2><ul class="mention-list">`
        + list.map((e) => `<li><a href="${rel}${pagePath(e.id)}">${esc(e.label)}</a></li>`).join('') + '</ul></section>';
    }).join('');
  return shell({ rel, ctx, title: 'All entries', url: `${ctx.site}e/`, description: `All ${entities.length} entries of the 10H record: people, documents, events, laws and concepts, each with its sources.`, body, jsonld: null, ogType: 'website' });
}

function sitemap(entities: Array<{ id: string }>, ctx: Ctx): string {
  const day = ctx.builtAt.slice(0, 10);
  const urls = ['', 'e/', 'bibliography/', ...entities.map((e) => pagePath(e.id))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((u) => `<url><loc>${esc(ctx.site + u)}</loc>${day ? `<lastmod>${day}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
}

// Head tags shared by the app's index.html (see export.ts) and the static pages.
export function headTags(o: { site: string; title: string; url: string; description: string; ogType: string }): string {
  return [
    `<meta name="description" content="${esc(o.description)}">`,
    `<link rel="canonical" href="${esc(o.url)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${o.ogType}">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.url)}">`,
    `<meta property="og:image" content="${esc(o.site)}og.png">`,
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="en">',
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n  ');
}

export const FAVICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231f5f8b'/%3E%3Ctext x='16' y='21.5' font-family='Georgia,serif' font-size='14' font-weight='700' text-anchor='middle' fill='white'%3E10H%3C/text%3E%3C/svg%3E">`;

export function footer(rel: string): string {
  return `<footer class="site"><a href="${rel}">10H Explorer</a> · <a href="${rel}#/about">About, sources and rights</a> · `
    + `<a href="${rel}e/">All entries</a> · <a href="${rel}bibliography/">Bibliography</a> · <a href="${rel}10h.jsonld">Data (JSON-LD)</a> · `
    + '<a href="https://github.com/maschinenlesbar-org/10h-rule" rel="noopener">Source</a> · <a href="https://maschinenlesbar.org/">maschinenlesbar.org</a></footer>';
}

function shell(o: { rel: string; ctx: Ctx; title: string; url: string; description: string; body: string; jsonld: unknown; ogType: string }): string {
  const nav = [['#/story', 'Story'], ['#/questions', 'Questions'], ['#/effects', 'Effects'], ['#/laender', 'Länder'], ['e/', 'All entries'], ['bibliography/', 'Bibliography'], ['#/about', 'About']]
    .map(([h, t]) => `<a href="${o.rel}${h}">${t}</a>`).join('\n      ');
  // "</" inside a script element would end it early.
  const ld = o.jsonld ? `\n  <script type="application/ld+json">${JSON.stringify(o.jsonld).replace(/<\//g, '<\\/')}</script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${FAVICON}
  <title>${esc(o.title)} · ${SITE_NAME}</title>
  ${headTags({ site: o.ctx.site, title: o.title, url: o.url, description: o.description, ogType: o.ogType })}
  <link rel="stylesheet" href="${o.rel}web/styles.css">${ld}
</head>
<body>
  <header class="site">
    <a class="brand" href="${o.rel}">${SITE_NAME}</a>
    <nav aria-label="Sections">
      ${nav}
    </nav>
  </header>
  <main id="main">
${o.body}
  </main>
  ${footer(o.rel)}
</body>
</html>
`;
}
