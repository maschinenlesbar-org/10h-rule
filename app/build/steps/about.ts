// Step 6b: "about" links from confirmed mentions of concepts and places. A document is about an entity when the
// entity is mentioned at least 3 times on at least 2 pages (or twice in a document of up to 2 pages). Mentions in
// running heads ("… Sitzung. Berlin, Donnerstag, den …") do not count.

import { log, type Ctx } from '../lib/ctx.ts';
import { addStatement, addEvidence } from '../lib/db.ts';

const HEAD_BEFORE = /(Wahlperiode|Sitzung\.?|Drucksache [\d/]+)\s*[–-]?\s*$/;
const HEAD_AFTER = /^\s*,\s*(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag|den)\b/;

export function about(ctx: Ctx): void {
  const { db, report } = ctx;
  const rows = db.prepare(`SELECT m.entity_id, c.doc_id, c.file_id, c.page_from, c.text, m.start, m.end FROM mention m
    JOIN chunk c ON c.id = m.chunk_id JOIN entity e ON e.id = m.entity_id
    WHERE m.status = 'confirmed' AND e.type IN ('Concept', 'Place') AND m.start IS NOT NULL`).all() as Array<{ entity_id: string; doc_id: string; file_id: string; page_from: number; text: string; start: number; end: number }>;
  const docPages = new Map((db.prepare('SELECT doc_id, sum(pages) n FROM file GROUP BY doc_id').all() as Array<{ doc_id: string; n: number }>).map((r) => [r.doc_id, r.n]));
  const agg = new Map<string, { n: number; pages: Set<number>; first: { file: string; page: number } }>();
  let heads = 0;
  for (const r of rows) {
    if (HEAD_BEFORE.test(r.text.slice(Math.max(0, r.start - 40), r.start)) || HEAD_AFTER.test(r.text.slice(r.end, r.end + 20))) { heads++; continue; }
    const k = `${r.doc_id}|${r.entity_id}`;
    const a = agg.get(k) ?? { n: 0, pages: new Set<number>(), first: { file: r.file_id, page: r.page_from } };
    a.n++;
    a.pages.add(r.page_from);
    agg.set(k, a);
  }
  let n = 0;
  for (const [k, a] of agg) {
    const [doc, ent] = k.split('|');
    const small = (docPages.get(doc) ?? 99) <= 2;
    if (!(small ? a.n >= 2 : a.n >= 3 && a.pages.size >= 2)) continue;
    const id = addStatement(db, { subj: doc, pred: 'about', obj: ent, value: `${a.n} mentions on ${a.pages.size} pages`, marker: 'primary', method: 'dictionary', source: 'confirmed mentions' });
    addEvidence(db, id, { doc, file: a.first.file, page: a.first.page, readVia: 'text_layer' });
    n++;
  }
  report.count('About links (documents → concepts and places)', n);
  report.count('Mentions skipped as running heads', heads);
  log(`about: ${n} links (${heads} running-head mentions skipped)`);
}
