// Step 8: procedures (data/procedures.csv) and curated links (data/links.csv).
// Events join a procedure when they cite one of its documents, or when they come from the procedure's wiki page and
// fall within its dates. Curated links need evidence: the quote is searched in the evidence document's pages.

import { join } from 'node:path';
import { DATA, log, type Ctx } from '../lib/ctx.ts';
import { readCsv } from '../lib/text.ts';
import { upsertEntity, addAlias, addStatement, addEvidence } from '../lib/db.ts';
import { ensureDoc } from './wiki.ts';

const split = (s: string) => s.split('|').map((x) => x.trim()).filter(Boolean);

export function procedures(ctx: Ctx): void {
  const { db, report } = ctx;
  const say = (subj: string, pred: string, obj: string, extra: { start?: string | null; source: string; rationale?: string | null; marker?: string }) =>
    addStatement(db, { subj, pred, obj, start: extra.start ?? null, marker: extra.marker ?? 'primary', method: 'seed', source: extra.source, rationale: extra.rationale ?? null });

  const evOf = db.prepare(`SELECT id, json_extract(props, '$.date') date, json_extract(props, '$.pages') pages FROM entity WHERE type = 'Event'`);
  const events = evOf.all() as Array<{ id: string; date: string; pages: string }>;
  const documentedIn = db.prepare("SELECT DISTINCT subj FROM statement WHERE pred = 'documented_in' AND obj = ?");

  let n = 0;
  for (const p of readCsv(join(DATA, 'procedures.csv'))) {
    upsertEntity(db, p.id, 'Procedure', p.label, { start: p.start, end: p.end || null, status: p.status, arena: p.arena, description: p.description, source: p.source });
    addAlias(db, p.id, p.label, 'label');
    if (p.dip_vorgang) db.prepare('INSERT OR IGNORE INTO external_id VALUES (?, ?, ?, ?, ?)').run(p.id, 'dip_vorgang', p.dip_vorgang, 'confirmed', 'seed');
    const members = new Set<string>();
    for (const d of split(p.docs)) {
      ensureDoc(db, d);
      say(d, 'part_of', p.id, { source: `data/procedures.csv (${p.source})` });
      for (const r of documentedIn.all(d) as Array<{ subj: string }>) if (r.subj.startsWith('event/')) members.add(r.subj);
    }
    for (const e of events) {
      const pages: string[] = JSON.parse(e.pages ?? '[]');
      if (split(p.pages).some((pg) => pages.includes(pg)) && e.date >= p.start && (!p.end || e.date <= p.end)) members.add(e.id);
    }
    for (const e of members) say(e, 'part_of', p.id, { source: `data/procedures.csv (${p.source})` });
    n++;
  }

  // Curated links
  const eventOn = (date: string) => {
    const on = events.filter((e) => e.date === date);
    return (on.find((e) => JSON.parse(e.pages ?? '[]').includes('timeline.md')) ?? on[0])?.id ?? null;
  };
  const pagesOf = db.prepare('SELECT p.file_id, p.page_no, p.text, p.read_via FROM page p JOIN file f ON f.id = p.file_id WHERE f.doc_id = ? ORDER BY p.file_id, p.page_no');
  for (const l of readCsv(join(DATA, 'links.csv'))) {
    const resolve = (x: string) => (x.startsWith('event:') ? eventOn(x.slice(6)) : (db.prepare('SELECT id FROM entity WHERE id = ?').get(x) as { id: string } | undefined)?.id ?? null);
    const subj = resolve(l.subj), obj = resolve(l.obj);
    if (!subj || !obj) { report.add('FAIL: curated links with unknown ends (data/links.csv)', `${l.subj} ${l.pred} ${l.obj}`); ctx.failures = (ctx.failures ?? 0) + 1; continue; }
    const hit = (pagesOf.all(l.evidence_doc) as Array<{ file_id: string; page_no: number; text: string; read_via: string }>)
      .find((pg) => pg.text.replace(/\s+/g, ' ').includes(l.evidence_quote));
    const id = say(subj, l.pred, obj, { source: `data/links.csv (${l.source})`, rationale: l.rationale, marker: hit ? 'primary' : 'unverified' });
    if (hit) addEvidence(db, id, { doc: l.evidence_doc, file: hit.file_id, page: hit.page_no, quote: l.evidence_quote, readVia: hit.read_via });
    else report.add('Curated links whose evidence quote was not found (marked unverified)', `${l.subj} ${l.pred} ${l.obj}: "${l.evidence_quote}" in ${l.evidence_doc}`);
  }
  report.count('Procedures', n);
  log(`procedures: ${n}`);
}
