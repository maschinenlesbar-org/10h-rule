// Static export only: the database runs in the browser (official sqlite-wasm build, FTS5 included) and is wrapped in
// the small prepare().all/get/run interface the query code expects.

export interface StaticDb { prepare(sql: string): { all(...p: unknown[]): any[]; get(...p: unknown[]): any; run(...p: unknown[]): { changes: number } } }

export async function openStaticDb(dbUrl: string, vendorUrl: string): Promise<StaticDb> {
  const init = (await import(vendorUrl)).default;
  const sqlite3 = await init();
  const bytes = new Uint8Array(await (await fetch(dbUrl)).arrayBuffer());
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
