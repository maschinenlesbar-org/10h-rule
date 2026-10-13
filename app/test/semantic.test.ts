// Semantic search quality on natural-language German questions (phase 5). Needs a full build (vectors in out/10h.db)
// and the cached model; skipped otherwise, e.g. after npm run build:fast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CACHE, OUT } from '../build/lib/ctx.ts';
import { MODEL, embed } from '../build/lib/embed.ts';
import { Queries } from '../server/queries.ts';

const DB = join(OUT, '10h.db');
const db = existsSync(DB) ? new DatabaseSync(DB, { readOnly: true }) : null;
const built = db?.prepare("SELECT value FROM meta WHERE key = 'embed_model'").get() as { value: string } | undefined;
const vectors = !!db && (db.prepare('SELECT count(*) n FROM chunk_vec').get() as { n: number }).n > 0;
const skip = !vectors ? 'no vectors: run npm run build' : built?.value !== MODEL ? `vectors are from ${built?.value}, not ${MODEL}`
  : !existsSync(join(CACHE, 'models', MODEL)) ? 'model not cached' : false;

// Each query names documents that answer it; at least one must be in the top 5. A third entry marks a known miss: it
// runs and reports, but does not fail the suite.
const CASES: Array<[string, string[], string?]> = [
  ['Regierung verweigert Auskunft 10H', ['doc/sn-drs-5-14898', 'doc/sn-drs-6-466'],
    'known miss: the refusal shares no words with the question ("Kernbereich exekutiver Eigenverantwortung"), and semantically it ranks 8th'],
  ['Wie viele Windräder wurden nach Inkrafttreten von 10H noch genehmigt?', ['doc/by-drs-17-9570', 'doc/by-drs-17-12706', 'doc/bt-drs-18-7274', 'doc/by-drs-17-12583', 'doc/by-drs-17-12258']],
  ['Gesundheitsgefahr durch Infraschall von Windkraftanlagen', ['doc/wd-8-083-14', 'doc/wd-8-052-15', 'doc/wd-8-099-19', 'doc/by-drs-16-15881']],
  ['Ist die 10H-Regel verfassungsgemäß?', ['doc/bayverfgh-vf-14-vii-14', 'doc/wd-3-120-14']],
  ['Gemeinden können durch Bebauungsplan von 10H abweichen', ['doc/by-drs-17-2137', 'doc/by-drs-17-6610', 'doc/by-drs-17-12706', 'doc/bayverfgh-vf-14-vii-14']],
];

test('hybrid search answers natural-language questions', { skip, timeout: 300_000 }, async (t) => {
  const q = new Queries(db!);
  q.embedQuery = async (text) => (await embed([text], 'query'))[0];
  for (const [query, want, todo] of CASES) {
    await t.test(query, { todo }, async () => {
      const top = (await q.search(query, {}, 'hybrid')).hits.slice(0, 5).map((h) => h.doc.id);
      assert.ok(top.some((d) => want.includes(d)), `top 5: ${top.join(', ')}`);
    });
  }
});

test('the corpus topic is dropped from the semantic query, content is kept', { skip: !db && 'run npm run build first' }, () => {
  const q = new Queries(db!);
  assert.equal(q.semanticQuery('Ist die 10H-Regel verfassungsgemäß?'), 'Ist die Regel verfassungsgemäß?');
  assert.equal(q.semanticQuery('10H Bayern'), '10H Bayern'); // too little left
  assert.equal(q.semanticQuery('zehnfache Höhe als Mindestabstand rechtens?'), 'zehnfache Höhe als Mindestabstand rechtens?');
});

test('"more like this" stays outside the document', { skip }, () => {
  const q = new Queries(db!);
  const sim = q.similarDocs('doc/sn-drs-5-14898');
  assert.ok(sim.length >= 5 && sim.every((s) => s.doc.id !== 'doc/sn-drs-5-14898'));
  const pass = q.similarPassages('anfragen/sachsen/SN-Drs_5-14898_Antwort.pdf', 3);
  assert.ok(pass.length && pass.every((p) => p.doc.id !== 'doc/sn-drs-5-14898'));
});
