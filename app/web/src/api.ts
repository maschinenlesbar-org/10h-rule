// Data access. With the local server the views call the JSON API. In the static export (window.TENH_STATIC set by the
// exported index.html) the same query code runs in the browser on sqlite-wasm; semantic search and review writes are
// then unavailable. The start page needs only meta.json, so it appears before the database has loaded.
import type { EntityPage, SearchResult, PageView, ListRow, ReviewGroup, Meta, Story, SimilarDoc, SimilarPassage, QuestionRow, Observation, LandStatus, BibEntry } from './types.ts';

const STATIC = (globalThis as { TENH_STATIC?: { db: string; size: number; vendor: string; v?: string } }).TENH_STATIC;
export const isStatic = !!STATIC;

// Download progress of the database, for the loading message (static export only).
export const dbProgress = { loaded: 0, total: STATIC?.size ?? 0, done: false, listeners: new Set<() => void>() };

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : `Server error ${res.status}`);
  return res.json() as Promise<T>;
}

let bytes: Promise<Uint8Array> | null = null;
function dbBytes(): Promise<Uint8Array> {
  if (!bytes) bytes = import('./static-db.ts').then(({ download }) => download(STATIC!.db, STATIC!.size, (loaded, total) => {
    Object.assign(dbProgress, { loaded, total });
    for (const f of dbProgress.listeners) f();
  })).catch((err) => { bytes = null; throw err; });
  return bytes;
}

let local: Promise<any> | null = null;
function queries(): Promise<any> {
  if (!local) local = (async () => {
    const { openStaticDb } = await import('./static-db.ts');
    const db = await openStaticDb(dbBytes(), STATIC!.vendor);
    dbProgress.done = true;
    dbProgress.listeners.clear();
    const queriesUrl = '../../server/queries.ts'; // rewritten to .js by the export
    const { Queries } = await import(queriesUrl);
    return new Queries(db);
  })().catch((err) => { local = null; throw err; });
  return local;
}

// Downloads the database once the start page is shown and the browser is idle, unless the visitor asked to save data.
// Only the download: opening it would block the page, so that waits until a view asks for it.
export function prefetchDb(): void {
  if (!STATIC || (navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const start = () => (globalThis.requestIdleCallback ?? setTimeout)(() => { dbBytes().catch(() => {}); }, { timeout: 3000 });
  if (document.readyState === 'complete') setTimeout(start, 1500); else addEventListener('load', () => setTimeout(start, 1500), { once: true });
}

let metaJson: Promise<Meta> | null = null;
const notFound = <T>(x: T | null | undefined): T => { if (x === null || x === undefined) throw new Error('Not found'); return x; };

export const api = STATIC ? {
  meta: () => (metaJson ??= get<Meta>('meta.json', STATIC?.v ? { v: STATIC.v } : {}).catch((err) => { metaJson = null; throw err; })),
  story: async () => (await queries()).story() as Story,
  questions: async () => (await queries()).questions() as QuestionRow[],
  observations: async () => (await queries()).observations() as Observation[],
  laender: async () => (await queries()).laender() as LandStatus[],
  bibliography: async () => (await queries()).bibliography() as BibEntry[],
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
  bibliography: () => get<BibEntry[]>('api/bibliography'),
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
