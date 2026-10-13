// Step 5b: the bibliography. Every work outside the archive that the full text cites, with the page and quote of each
// citation: parliamentary documents (from the "cites" statements of step 5), and court decisions, legislation,
// literature and web sources (build/lib/biblio.ts). Works that are in the archive are left out, they are part of the
// record. Found by pattern, not reviewed: the view says so and links every citation to its page.

import { createHash } from 'node:crypto';
import { log, type Ctx } from '../lib/ctx.ts';
import { extractWorks, onTopic, type WorkRef } from '../lib/biblio.ts';
import { slug } from '../lib/ids.ts';

const FOOTER_DOCS = 3;  // a bare domain in this many documents is an imprint or footer, not a source
const FOOTER_PAGES = 3; // same for this many pages of one document (letterheads)

interface Cite { doc: string; file: string; page: number; quote: string; onTopic: boolean }
interface Work { key: string; kind: WorkRef['kind']; labels: Map<string, number>; url: string | null; detail: Record<string, string>; cites: Cite[] }

export function bibliography(ctx: Ctx): void {
  const { db, report } = ctx;
  const pages = db.prepare(`SELECT p.file_id, p.page_no, p.text, f.doc_id FROM page p JOIN file f ON f.id = p.file_id ORDER BY p.file_id, p.page_no`)
    .all() as Array<{ file_id: string; page_no: number; text: string; doc_id: string }>;
  const topical = new Map(pages.map((p) => [`${p.file_id}#${p.page_no}`, onTopic(p.text)]));
  const insWork = db.prepare('INSERT INTO work (id, kind, label, entity_id, url, props) VALUES (?, ?, ?, ?, ?, ?)');
  const insCite = db.prepare('INSERT INTO work_citation (work_id, doc_id, file_id, page, quote, on_topic) VALUES (?, ?, ?, ?, ?, ?)');

  // 1. Parliamentary documents (and BayVerfGH decisions) cited but not archived: already entities, linked by step 5.
  const cited = db.prepare(`SELECT s.obj id, e.label, d.source_url url, ev.doc_id, ev.file_id, ev.page, ev.quote
    FROM statement s JOIN document d ON d.id = s.obj AND d.archived = 0 JOIN entity e ON e.id = s.obj JOIN evidence ev ON ev.statement_id = s.id
    WHERE s.pred = 'cites' AND ev.file_id IS NOT NULL ORDER BY s.obj`).all() as Array<Record<string, any>>;
  const parl = new Set<string>();
  for (const r of cited) {
    if (!parl.has(r.id)) {
      parl.add(r.id);
      insWork.run(r.id, r.id.startsWith('doc/bayverfgh-') ? 'court' : 'parliamentary', r.label, r.id, r.url, '{}');
    }
    insCite.run(r.id, r.doc_id, r.file_id, r.page, r.quote, topical.get(`${r.file_id}#${r.page}`) ? 1 : 0);
  }

  // 2. Everything else, by pattern.
  const works = new Map<string, Work>();
  for (const p of pages) {
    for (const w of extractWorks(p.text)) {
      let work = works.get(w.key);
      if (!work) works.set(w.key, work = { key: w.key, kind: w.kind, labels: new Map(), url: w.url, detail: {}, cites: [] });
      work.labels.set(w.label, (work.labels.get(w.label) ?? 0) + 1);
      Object.assign(work.detail, w.detail);
      work.cites.push({ doc: p.doc_id, file: p.file_id, page: p.page_no, quote: w.raw, onTopic: topical.get(`${p.file_id}#${p.page_no}`)! });
    }
  }

  // A decision cited once by date only and once by date and file number is one decision.
  const byDate = new Map<string, Work>();
  for (const w of works.values()) if (w.kind === 'court' && w.detail.az && w.detail.date) byDate.set(`${w.detail.court}|${w.detail.date}`, w);
  for (const w of [...works.values()]) {
    if (w.kind !== 'court' || w.detail.az || !w.detail.date) continue;
    const full = byDate.get(`${w.detail.court}|${w.detail.date}`);
    if (!full) continue;
    full.cites.push(...w.cites);
    works.delete(w.key);
  }

  // Works that are in the record already: BayVerfGH decisions (by Vf. number or by the date in the file name) and
  // Bavarian gazette issues. Their Vf. numbers are linked by step 5.
  const docExists = db.prepare('SELECT archived FROM document WHERE id = ?');
  const fileByDate = db.prepare(`SELECT doc_id FROM file WHERE id LIKE ? ESCAPE '\\'`);
  const inRecord = (w: Work): string | null => {
    const d = w.detail;
    if (w.kind === 'court' && d.court === 'BayVerfGH') {
      const vf = d.az?.match(/^Vf\.\s?(\d+)-([IVX]+)-(\d{2})$/);
      if (vf) { const id = `doc/bayverfgh-vf-${vf[1]}-${vf[2].toLowerCase()}-${vf[3]}`; if (docExists.get(id)) return id; }
      if (d.date) { const f = fileByDate.get(`%BayVerfGH\\_${d.date}\\_%`) as { doc_id: string } | undefined; if (f) return f.doc_id; }
    }
    if (w.kind === 'legislation' && d.gazette === 'GVBl.') {
      const id = `doc/by-gvbl-${d.year}-${d.page}`;
      if (docExists.get(id)) return id;
    }
    return null;
  };

  // Bare domains that recur across documents or pages are imprints, letterheads and footers.
  const isFooter = (w: Work): boolean => {
    if (w.kind !== 'web' || w.detail.path) return false;
    const perDoc = new Map<string, number>();
    for (const c of w.cites) perDoc.set(c.doc, (perDoc.get(c.doc) ?? 0) + 1);
    return perDoc.size >= FOOTER_DOCS || Math.max(...perDoc.values()) >= FOOTER_PAGES;
  };

  const counts: Record<string, number> = {};
  for (const w of works.values()) {
    const rec = inRecord(w);
    if (rec) { report.add('Bibliography: works already in the record, archived or linked by step 5 (left out)', `${bestLabel(w)} → ${rec} (${w.cites.length}×)`); continue; }
    if (isFooter(w)) { report.add('Bibliography: bare domains taken as imprints or footers (left out)', `${bestLabel(w)} (${w.cites.length}× in ${new Set(w.cites.map((c) => c.doc)).size} documents)`); continue; }
    const id = workId(w);
    insWork.run(id, w.kind, bestLabel(w), null, w.url, JSON.stringify(w.detail));
    const seen = new Set<string>();
    for (const c of w.cites) {
      const k = `${c.file}#${c.page}`;
      if (seen.has(k)) continue; // one citation per page
      seen.add(k);
      insCite.run(id, c.doc, c.file, c.page, c.quote, c.onTopic ? 1 : 0);
    }
    counts[w.kind] = (counts[w.kind] ?? 0) + 1;
  }
  counts.parliamentary = parl.size;
  for (const [k, n] of Object.entries(counts)) report.count(`Bibliography: ${k}`, n);
  log(`bibliography: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`);
}

// The most complete label (with authors, decision type and date); among equals, the one cited most often.
function bestLabel(w: Work): string {
  return [...w.labels].sort((a, b) => b[0].length - a[0].length || b[1] - a[1])[0][0];
}

// Readable and stable: kind plus a slug of the key, cut short, with a hash so long keys stay unique.
function workId(w: Work): string {
  const s = slug(w.key.split('|').slice(1).join(' ')).slice(0, 60).replace(/-+$/, '');
  return `work/${w.kind}/${s}-${createHash('sha1').update(w.key).digest('hex').slice(0, 6)}`;
}
