// Data access. With the local server the views call the JSON API. In the static export (window.TENH_STATIC set by the
// exported index.html) the same query code runs in the browser on sqlite-wasm; semantic search and review writes are
// then unavailable. The start page needs only meta.json, so it appears before the database has loaded.
                                                                                                                                                                                    

const STATIC = (globalThis                                                                              ).TENH_STATIC;
export const isStatic = !!STATIC;

// Download progress of the database, for the loading message (static export only).
export const dbProgress = { loaded: 0, total: STATIC?.size ?? 0, done: false, listeners: new Set            () };

async function get   (path        , params                         = {})             {
  const res = await fetch(`${path}?${new URLSearchParams(params)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : `Server error ${res.status}`);
  return res.json()              ;
}

let bytes                             = null;
function dbBytes()                      {
  if (!bytes) bytes = import('./static-db.js?v=e7a98de609').then(({ download }) => download(STATIC .db, STATIC .size, (loaded, total) => {
    Object.assign(dbProgress, { loaded, total });
    for (const f of dbProgress.listeners) f();
  })).catch((err) => { bytes = null; throw err; });
  return bytes;
}

let local                      = null;
function queries()               {
  if (!local) local = (async () => {
    const { openStaticDb } = await import('./static-db.js?v=e7a98de609');
    const db = await openStaticDb(dbBytes(), STATIC .vendor);
    dbProgress.done = true;
    dbProgress.listeners.clear();
    const queriesUrl = '../../server/queries.js?v=e7a98de609'; // rewritten to .js by the export
    const { Queries } = await import(queriesUrl);
    return new Queries(db);
  })().catch((err) => { local = null; throw err; });
  return local;
}

// Downloads the database once the start page is shown and the browser is idle, unless the visitor asked to save data.
// Only the download: opening it would block the page, so that waits until a view asks for it.
export function prefetchDb()       {
  if (!STATIC || (navigator                                           ).connection?.saveData) return;
  const start = () => (globalThis.requestIdleCallback ?? setTimeout)(() => { dbBytes().catch(() => {}); }, { timeout: 3000 });
  if (document.readyState === 'complete') setTimeout(start, 1500); else addEventListener('load', () => setTimeout(start, 1500), { once: true });
}

let metaJson                       = null;
const notFound =    (x                      )    => { if (x === null || x === undefined) throw new Error('Not found'); return x; };

export const api = STATIC ? {
  meta: () => (metaJson ??= get      ('meta.json', STATIC?.v ? { v: STATIC.v } : {}).catch((err) => { metaJson = null; throw err; })),
  story: async () => (await queries()).story()         ,
  questions: async () => (await queries()).questions()                 ,
  observations: async () => (await queries()).observations()                 ,
  laender: async () => (await queries()).laender()                ,
  bibliography: async () => (await queries()).bibliography()              ,
  search: async (q        , f                        ) => (await queries()).search(q, f, 'keyword')                         ,
  entity: async (id        ) => notFound((await queries()).entity(id))              ,
  similarDocs: async (doc        ) => (await queries()).similarDocs(doc)                ,
  similarPassages: async (file        , n        ) => (await queries()).similarPassages(file, n)                    ,
  page: async (file        , n        ) => notFound((await queries()).page(file, n))            ,
  list: async (kind        ) => (await queries()).list(kind)             ,
  review: async (type        , status        ) => (await queries()).review(type, status)                 ,
  setReview: async (_e        , _s        , _st        )                               => { throw new Error('The published version is read-only.'); },
} : {
  meta: () => get      ('api/meta'),
  story: () => get       ('api/story'),
  questions: () => get               ('api/questions'),
  observations: () => get               ('api/observations'),
  laender: () => get              ('api/laender'),
  bibliography: () => get            ('api/bibliography'),
  search: (q        , f                        ) => get              ('api/search', { q, ...f }),
  entity: (id        ) => get            ('api/entity', { id }),
  similarDocs: (doc        ) => get              ('api/similar', { doc }),
  similarPassages: (file        , n        ) => get                  ('api/similar', { file, n: String(n) }),
  page: (file        , n        ) => get          ('api/page', { file, n: String(n) }),
  list: (kind        ) => get           ('api/list', { kind }),
  review: (type        , status        ) => get               ('api/review', { type, status }),
  setReview: async (entity_id        , surface        , status        ) => {
    const res = await fetch('api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity_id, surface, status }) });
    if (!res.ok) throw new Error((await res.json()).error ?? `Server error ${res.status}`);
    return res.json()                                ;
  },
};
