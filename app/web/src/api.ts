// Data access. With the local server the views call the JSON API. In the static export (window.TENH_STATIC set by the
// exported index.html) the same query code runs in the browser on sqlite-wasm; semantic search and review writes are
// then unavailable.
import type { EntityPage, SearchResult, PageView, ListRow, ReviewGroup, Meta, Story, SimilarDoc, SimilarPassage, QuestionRow, Observation, LandStatus } from './types.ts';

const STATIC = (globalThis as { TENH_STATIC?: { db: string; vendor: string } }).TENH_STATIC;

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : `Server error ${res.status}`);
  return res.json() as Promise<T>;
}

let local: Promise<any> | null = null;
function queries(): Promise<any> {
  if (!local) local = (async () => {
    const { openStaticDb } = await import('./static-db.ts');
    const db = await openStaticDb(STATIC!.db, STATIC!.vendor);
    const queriesUrl = '../../server/queries.ts'; // rewritten to .js by the export
    const { Queries } = await import(queriesUrl);
    return new Queries(db);
  })();
  return local;
}
const notFound = <T>(x: T | null | undefined): T => { if (x === null || x === undefined) throw new Error('Not found'); return x; };

export const api = STATIC ? {
  meta: async () => (await queries()).meta() as Meta,
  story: async () => (await queries()).story() as Story,
  questions: async () => (await queries()).questions() as QuestionRow[],
  observations: async () => (await queries()).observations() as Observation[],
  laender: async () => (await queries()).laender() as LandStatus[],
  search: async (q: string, f: Record<string, string>) => (await queries()).search(q, f, 'keyword') as Promise<SearchResult>,
  entity: async (id: string) => notFound((await queries()).entity(id)) as EntityPage,
  similarDocs: async (doc: string) => (await queries()).similarDocs(doc) as SimilarDoc[],
  similarPassages: async (file: string, n: number) => (await queries()).similarPassages(file, n) as SimilarPassage[],
  page: async (file: string, n: number) => notFound((await queries()).page(file, n)) as PageView,
  list: async (kind: string) => (await queries()).list(kind) as ListRow[],
  review: async (type: string, status: string) => (await queries()).review(type, status) as ReviewGroup[],
  setReview: async (_e: string, _s: string, _st: string): Promise<{ changed: number }> => { throw new Error('The published version is read-only.'); },
} : {
  meta: () => get<Meta>('api/meta'),
  story: () => get<Story>('api/story'),
  questions: () => get<QuestionRow[]>('api/questions'),
  observations: () => get<Observation[]>('api/observations'),
  laender: () => get<LandStatus[]>('api/laender'),
  search: (q: string, f: Record<string, string>) => get<SearchResult>('api/search', { q, ...f }),
  entity: (id: string) => get<EntityPage>('api/entity', { id }),
  similarDocs: (doc: string) => get<SimilarDoc[]>('api/similar', { doc }),
  similarPassages: (file: string, n: number) => get<SimilarPassage[]>('api/similar', { file, n: String(n) }),
  page: (file: string, n: number) => get<PageView>('api/page', { file, n: String(n) }),
  list: (kind: string) => get<ListRow[]>('api/list', { kind }),
  review: (type: string, status: string) => get<ReviewGroup[]>('api/review', { type, status }),
  setReview: async (entity_id: string, surface: string, status: string) => {
    const res = await fetch('api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_id, surface, status }) });
    if (!res.ok) throw new Error((await res.json()).error ?? `Server error ${res.status}`);
    return res.json() as Promise<{ changed: number }>;
  },
};
