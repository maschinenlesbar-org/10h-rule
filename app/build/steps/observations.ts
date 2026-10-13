// Step 8b: observations (numbers from government answers) and the Länder status, from data/*.csv.
// Each observation quote must be found in its document's text; otherwise the value is loaded as unverified.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, log, type Ctx } from '../lib/ctx.ts';
import { readCsv } from '../lib/text.ts';

const norm = (s: string) => s.replace(/(\w)-\s+(\w)/g, '$1$2').replace(/\s+/g, ' ').trim();

export function observations(ctx: Ctx): void {
  const { db, report } = ctx;
  const pagesOf = db.prepare('SELECT p.file_id, p.page_no, p.text FROM page p JOIN file f ON f.id = p.file_id WHERE f.doc_id = ? ORDER BY p.file_id, p.page_no');
  const file = join(DATA, 'observations.csv');
  let ok = 0, bad = 0;
  if (existsSync(file)) {
    const ins = db.prepare(`INSERT INTO observation (id, metric, value, unit, period_start, period_end, place_id, doc_id, file_id, page, quote, note, verified)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of readCsv(file)) {
      const q = norm(r.quote ?? '');
      const hit = q ? (pagesOf.all(r.doc_id) as Array<{ file_id: string; page_no: number; text: string }>).find((p) => norm(p.text).includes(q)) : undefined;
      ins.run(r.id, r.metric, Number(r.value), r.unit, r.period_start || null, r.period_end || null, r.place || null, r.doc_id,
        hit?.file_id ?? null, hit?.page_no ?? null, r.quote, r.note, hit ? 1 : 0);
      if (hit) ok++; else { bad++; report.add('Observations whose quote was not found (loaded as unverified)', `${r.id}: "${r.quote}" in ${r.doc_id}`); }
    }
  }
  const lfile = join(DATA, 'laender-status.csv');
  let l = 0;
  if (existsSync(lfile)) {
    const ins = db.prepare('INSERT INTO land_status (land_id, status, summary, marker, doc_id, source) VALUES (?, ?, ?, ?, ?, ?)');
    for (const r of readCsv(lfile)) { ins.run(r.land, r.status, r.summary, r.marker, r.doc_id || null, r.source); l++; }
  }
  report.count('Observations (verified quote)', ok);
  if (bad) report.count('Observations (quote not found)', bad);
  report.count('Länder with a status', l);
  log(`observations: ${ok} verified, ${bad} unverified; ${l} Länder`);
}
