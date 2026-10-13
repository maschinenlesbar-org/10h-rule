// Step 10: chunk embeddings and precomputed neighbours ("more like this").
// Vectors are cached by SHA-256 of the chunk text in .cache/embed-<model>.sqlite, so a rebuild only embeds new text.
// Neighbours come from other documents only; a passage's own document is not "more like this".

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { CACHE, log, type Ctx } from '../lib/ctx.ts';
import { MODEL, embed, toBlob, fromBlob } from '../lib/embed.ts';
import { slug } from '../lib/ids.ts';

const BATCH = 8, K = 10;

export async function embedChunks(ctx: Ctx): Promise<void> {
  const { db, report } = ctx;
  if (!ctx.opts.embed) { report.add('Embeddings skipped (--no-embed)', 'semantic search and "more like this" are unavailable'); return; }
  mkdirSync(CACHE, { recursive: true });
  const cache = new DatabaseSync(join(CACHE, `embed-${slug(MODEL)}.sqlite`));
  cache.exec('CREATE TABLE IF NOT EXISTS vec (hash TEXT PRIMARY KEY, v BLOB NOT NULL)');
  const getCached = cache.prepare('SELECT v FROM vec WHERE hash = ?');
  const putCached = cache.prepare('INSERT OR REPLACE INTO vec (hash, v) VALUES (?, ?)');

  const chunks = db.prepare('SELECT id, doc_id, text FROM chunk ORDER BY id').all() as Array<{ id: number; doc_id: string; text: string }>;
  const ins = db.prepare('INSERT INTO chunk_vec (chunk_id, v) VALUES (?, ?)');
  const DIM = (await embed(['dimension probe'], 'passage'))[0].length;
  const vecs = new Float32Array(chunks.length * DIM);
  const todo: Array<{ i: number; hash: string; text: string }> = [];
  chunks.forEach((c, i) => {
    const hash = createHash('sha256').update(c.text).digest('hex');
    const hit = getCached.get(hash) as { v: Uint8Array } | undefined;
    if (hit) vecs.set(fromBlob(hit.v), i * DIM);
    else todo.push({ i, hash, text: c.text });
  });
  log(`embed: ${chunks.length - todo.length} cached, ${todo.length} to embed`);
  const t0 = Date.now();
  for (let b = 0; b < todo.length; b += BATCH) {
    const batch = todo.slice(b, b + BATCH);
    const out = await embed(batch.map((x) => x.text), 'passage');
    cache.exec('BEGIN');
    batch.forEach((x, k) => { vecs.set(out[k], x.i * DIM); putCached.run(x.hash, toBlob(out[k])); });
    cache.exec('COMMIT');
    if ((b / BATCH) % 30 === 0) log(`embed: ${Math.min(b + BATCH, todo.length)}/${todo.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  cache.close();
  chunks.forEach((c, i) => ins.run(c.id, toBlob(vecs.subarray(i * DIM, (i + 1) * DIM))));

  // Chunk neighbours (other documents only)
  const insN = db.prepare('INSERT INTO chunk_neighbor (chunk_id, neighbor_id, score, rank) VALUES (?, ?, ?, ?)');
  const n = chunks.length;
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = vecs.subarray(i * DIM, (i + 1) * DIM);
    for (let j = 0; j < n; j++) {
      if (chunks[j].doc_id === chunks[i].doc_id) { scores[j] = -2; continue; }
      let s = 0;
      const o = j * DIM;
      for (let k = 0; k < DIM; k++) s += a[k] * vecs[o + k];
      scores[j] = s;
    }
    topK(scores, K).forEach(([j, s], r) => insN.run(chunks[i].id, chunks[j].id, s, r + 1));
  }

  // Document neighbours: mean of the document's chunk vectors, normalised.
  const byDoc = new Map<string, Float32Array>();
  chunks.forEach((c, i) => {
    const acc = byDoc.get(c.doc_id) ?? new Float32Array(DIM);
    for (let k = 0; k < DIM; k++) acc[k] += vecs[i * DIM + k];
    byDoc.set(c.doc_id, acc);
  });
  const docs = [...byDoc.keys()];
  const dv = docs.map((d) => { const v = byDoc.get(d)!; const len = Math.hypot(...v) || 1; return v.map((x) => x / len); });
  const insD = db.prepare('INSERT INTO doc_neighbor (doc_id, neighbor_id, score, rank) VALUES (?, ?, ?, ?)');
  const ds = new Float32Array(docs.length);
  docs.forEach((d, i) => {
    dv.forEach((v, j) => { ds[j] = i === j ? -2 : v.reduce((s, x, k) => s + x * dv[i][k], 0); });
    topK(ds, K).forEach(([j, s], r) => insD.run(d, docs[j], s, r + 1));
  });
  report.count('Chunks with embeddings', n);
  log(`embed: neighbours for ${n} chunks and ${docs.length} documents`);
}

function topK(scores: Float32Array, k: number): Array<[number, number]> {
  const best: Array<[number, number]> = [];
  for (let j = 0; j < scores.length; j++) {
    const s = scores[j];
    if (s <= -1) continue;
    if (best.length < k) { best.push([j, s]); best.sort((a, b) => b[1] - a[1]); }
    else if (s > best[k - 1][1]) { best[k - 1] = [j, s]; best.sort((a, b) => b[1] - a[1]); }
  }
  return best;
}
