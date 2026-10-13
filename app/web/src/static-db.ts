// Static export only: the database runs in the browser (official sqlite-wasm build, FTS5 included) and is wrapped in
// the small prepare().all/get/run interface the query code expects.

export interface StaticDb { prepare(sql: string): { all(...p: unknown[]): any[]; get(...p: unknown[]): any; run(...p: unknown[]): { changes: number } } }

// Reported while the database downloads. `total` is the uncompressed size written by the export: the host may send
// the file gzipped, so Content-Length would not match the bytes the stream delivers.
export type Progress = (loaded: number, total: number) => void;

// Opening is the expensive part (it blocks the main thread), so the download can start early and the open waits until
// a view needs the database.
export async function openStaticDb(bytesPromise: Promise<Uint8Array>, vendorUrl: string): Promise<StaticDb> {
  const [init, bytes] = await Promise.all([import(vendorUrl).then((m) => m.default), bytesPromise]);
  const sqlite3 = await init();
  const ptr = sqlite3.wasm.allocFromTypedArray(bytes);
  const db = new sqlite3.oo1.DB();
  const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', ptr, bytes.byteLength, bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY);
  db.checkRc(rc);
  const bind = (p: unknown[]) => (p.length ? p.map((v) => (v === undefined ? null : v)) : undefined);
  return {
    prepare: (sql: string) => ({
      all: (...p: unknown[]) => db.selectObjects(sql, bind(p)),
      get: (...p: unknown[]) => db.selectObjects(sql, bind(p))[0],
      run: (...p: unknown[]) => { db.exec({ sql, bind: bind(p) }); return { changes: db.changes() }; },
    }),
  };
}

export async function download(url: string, size: number, onProgress: Progress): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not load the database (${res.status})`);
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, Math.max(size, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return bytes;
}
