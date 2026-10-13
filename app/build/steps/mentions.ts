// Step 6: entity linking on chunks. People and laws (full names, exact legal citations) and document references
// are precise and accepted ("confirmed"). Organisations, places and concepts produce false positives and start as
// "auto" for review (CONCEPT.md, section 5).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, log, type Ctx } from '../lib/ctx.ts';
import { readCsv } from '../lib/text.ts';
import { Dict } from '../lib/dict.ts';
import { extractRefs, parliamentOf } from '../lib/refs.ts';

const CONFIRMED_TYPES = new Set(['Person', 'Law']);

export function mentions(ctx: Ctx): void {
  const { db, report } = ctx;
  // People only by full name in documents; surnames alone are reserved for the wiki.
  const people = new Dict(db, { types: ['Person'], kinds: ['label'] });
  const things = new Dict(db, { types: ['Organization', 'Place', 'Concept', 'Law'] });
  const ins = db.prepare('INSERT INTO mention (chunk_id, entity_id, start, end, surface, method, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const docExists = db.prepare('SELECT 1 FROM entity WHERE id = ?');
  const chunks = db.prepare('SELECT id, doc_id, text FROM chunk').all() as Array<{ id: number; doc_id: string; text: string }>;
  const ambiguous = new Map<string, number>();
  let n = 0;
  for (const c of chunks) {
    for (const d of [people, things]) {
      const { hits, ambiguous: amb } = d.match(c.text);
      for (const a of amb) ambiguous.set(a, (ambiguous.get(a) ?? 0) + 1);
      for (const h of hits) {
        ins.run(c.id, h.entityId, h.start, h.end, h.surface.replace(/\s+/g, ' '), 'dictionary', CONFIRMED_TYPES.has(h.type) ? 'confirmed' : 'auto');
        n++;
      }
    }
    for (const r of extractRefs(c.text, parliamentOf(c.doc_id))) {
      if (!r.id || r.id === c.doc_id || !docExists.get(r.id)) continue;
      ins.run(c.id, r.id, null, null, r.raw, 'regex', 'confirmed');
      n++;
    }
  }
  // Review decisions apply per entity and surface form. An optional scope (a parliament code such as "by") limits a
  // decision to documents of that parliament; scoped decisions are applied after the general ones and win.
  const reviewFile = join(DATA, 'mention-review.csv');
  if (existsSync(reviewFile)) {
    const upd = db.prepare(`UPDATE mention SET status = ? WHERE entity_id = ? AND surface = ?
      AND (? = '' OR chunk_id IN (SELECT c.id FROM chunk c JOIN document d ON d.id = c.doc_id WHERE d.parliament = ?))`);
    const decisions = readCsv(reviewFile).sort((a, b) => (a.scope ? 1 : 0) - (b.scope ? 1 : 0));
    let k = 0;
    for (const r of decisions) k += Number(upd.run(r.status, r.entity_id, r.surface, r.scope ?? '', r.scope ?? '').changes);
    report.count('Mentions set by review decisions', k);
  }
  for (const [a, k] of [...ambiguous].sort((x, y) => y[1] - x[1])) report.add('Ambiguous aliases skipped in entity linking', `${a} × ${k}`);
  const byStatus = db.prepare(`SELECT e.type, m.status, count(*) n FROM mention m JOIN entity e ON e.id = m.entity_id GROUP BY 1, 2 ORDER BY 1, 2`)
    .all() as Array<{ type: string; status: string; n: number }>;
  for (const s of byStatus) report.count(`Mentions: ${s.type} (${s.status})`, s.n);
  log(`mentions: ${n}`);
}
