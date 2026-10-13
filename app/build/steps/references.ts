// Step 5: references in the full text of every page → "cites" statements with page evidence.
// Bare references are resolved with the issuing parliament of the citing document; unresolved ones are reported.

import { log, type Ctx } from '../lib/ctx.ts';
import { extractRefs, parliamentOf, lawLabel } from '../lib/refs.ts';
import { upsertEntity, addAlias, addStatement, addEvidence } from '../lib/db.ts';
import { ensureDoc } from './wiki.ts';

const MAX_EVIDENCE = 5; // evidence rows kept per citing document and target

export function references(ctx: Ctx): void {
  const { db, report } = ctx;
  const pages = db.prepare(`SELECT p.file_id, p.page_no, p.text, p.read_via, f.doc_id FROM page p JOIN file f ON f.id = p.file_id
                            ORDER BY p.file_id, p.page_no`).all() as Array<{ file_id: string; page_no: number; text: string; read_via: string; doc_id: string }>;
  const pairs = new Map<string, { id: string; n: number }>();
  const unresolved = new Map<string, number>();
  for (const p of pages) {
    for (const r of extractRefs(p.text, parliamentOf(p.doc_id))) {
      if (!r.id) { unresolved.set(r.raw, (unresolved.get(r.raw) ?? 0) + 1); continue; }
      if (r.id === p.doc_id) continue; // self-reference (header, own number)
      if (r.kind === 'law') {
        upsertEntity(db, r.id, 'Law', lawLabel(r.id), {});
        addAlias(db, r.id, lawLabel(r.id), 'label');
      } else ensureDoc(db, r.id);
      const key = `${p.doc_id}|${r.id}`;
      let pair = pairs.get(key);
      if (!pair) {
        pair = { id: addStatement(db, { subj: p.doc_id, pred: 'cites', obj: r.id, marker: 'primary', method: 'regex', source: `${p.file_id}#${p.page_no}` }), n: 0 };
        pairs.set(key, pair);
      }
      if (pair.n++ < MAX_EVIDENCE) addEvidence(db, pair.id, { doc: p.doc_id, file: p.file_id, page: p.page_no, quote: r.raw, readVia: p.read_via });
    }
  }
  const top = [...unresolved].sort((a, b) => b[1] - a[1]);
  for (const [raw, n] of top) report.add('Unresolved references in the full text (raw form, count)', `\`${raw}\` × ${n}`);
  report.count('Citation links (document → document or law)', pairs.size);
  log(`references: ${pairs.size} citation links, ${unresolved.size} distinct unresolved forms`);
}
