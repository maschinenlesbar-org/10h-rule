// Sentence embeddings with BAAI bge-m3 (1024 dimensions, CLS pooling, no prefixes), run locally through transformers.js.
// Chosen on seven German questions against the whole corpus (8,388 chunks): a target document was in the top 5 for 5 of 7
// questions, against 4 of 7 for multilingual-e5-small, and its worst ranks were 23rd and 15th against 41st and 42nd
// (e5-base and paraphrase-multilingual-MiniLM were weaker than e5-small on a smaller test).
// It is slower (about 3.5 chunks/s on a laptop CPU), so vectors are cached by text hash.

import { join } from 'node:path';
import { CACHE } from './ctx.ts';

export const MODEL = 'Xenova/bge-m3';
// Pinned: the model is downloaded from Hugging Face and its ONNX file parsed by native code, so an upstream change must
// not arrive silently. Revision of 10.02.2026; on 13.10.2026 the cached files were checked against it (the ONNX file by
// its LFS SHA-256). To update: change the hash, check the new files, rebuild the embeddings.
export const MODEL_REVISION = '4de13258303883538bd53b696b452bf8099f0858';
export { toBlob, fromBlob } from './vec.ts';

type Extractor = (texts: string[], opts: { pooling: 'cls' | 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;

let loading: Promise<Extractor> | null = null;
export function embedder(): Promise<Extractor> {
  if (!loading) {
    loading = (async () => {
      const t = await import('@huggingface/transformers');
      t.env.cacheDir = join(CACHE, 'models');
      // The pipeline lists its files from a config.json it fetches without the revision; fixing the commit in the URL
      // template makes that request use the pinned revision too.
      t.env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
      return (await t.pipeline('feature-extraction', MODEL, { dtype: 'q8', revision: MODEL_REVISION })) as unknown as Extractor;
    })();
  }
  return loading;
}

export async function embed(texts: string[], _kind: 'query' | 'passage'): Promise<Float32Array[]> {
  const fe = await embedder();
  const out = await fe(texts, { pooling: 'cls', normalize: true });
  return out.tolist().map((v) => Float32Array.from(v));
}


export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
