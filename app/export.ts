// Static export (phase 6): node export.ts [--no-files]
// Writes dist/: the app as plain JavaScript (types stripped, imports rewritten to .js), a trimmed database for the
// browser (no vectors: keyword search and precomputed "more like this" only), the sqlite-wasm runtime, the archived
// PDFs (unless --no-files), a JSON-LD dump of the graph, meta.json for the start page (so it shows before the database
// has loaded), and a plain HTML page per entity with sitemap.xml (export-pages.ts). Serve dist/ from any static host,
// e.g. GitHub Pages. SITE_URL sets the public address used in canonical links, Open Graph tags and the sitemap.

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { APP, OUT, WIKI } from './build/lib/ctx.ts';
import { Queries } from './server/queries.ts';
import { writeStaticPages, headTags, footer, pagePath } from './export-pages.ts';

const args = new Set(process.argv.slice(2));
const DIST = join(APP, 'dist');
const SIZE_BUDGET_MB = 60; // database the browser downloads
const SITE = (process.env.SITE_URL ?? 'https://maschinenlesbar.org/10h-rule/').replace(/\/?$/, '/');
const DESCRIPTION = 'How Bayern got the 10H rule for wind turbines, 2013–2016: the documents, people, events and votes, each fact linked to the page of the primary source that backs it.';
const log = (...a: unknown[]) => console.log('[export]', ...a);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1. Code: the browser app plus the query code it shares with the server.
const sources = [
  ...walk(join(APP, 'web', 'src')),
  join(APP, 'server', 'queries.ts'),
  ...['dict.ts', 'refs.ts', 'ids.ts', 'vec.ts'].map((f) => join(APP, 'build', 'lib', f)),
];
for (const src of sources) {
  const js = stripTypeScriptTypes(readFileSync(src, 'utf8'), { mode: 'strip' })
    .replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2')
    .replace(/(import\(\s*['"][^'"]+)\.ts(['"]\s*\))/g, '$1.js$2')
    .replace(/(['"]\.\.\/\.\.\/server\/queries)\.ts(['"])/g, '$1.js$2');
  const dest = join(DIST, relative(APP, src)).replace(/\.ts$/, '.js');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, js);
}
copyFileSync(join(APP, 'web', 'styles.css'), join(DIST, 'web', 'styles.css'));
copyFileSync(join(APP, 'web', 'og.png'), join(DIST, 'og.png'));
log(`code: ${sources.length} modules`);

// 2. sqlite-wasm runtime
cpSync(join(APP, 'node_modules', '@sqlite.org', 'sqlite-wasm', 'dist'), join(DIST, 'vendor', 'sqlite-wasm'), { recursive: true,
  filter: (p) => !/node\.mjs$|\.d\.mts$/.test(p) });

// 3. Database for the browser: without vectors (semantic search needs the local server).
const webDb = join(DIST, '10h-web.db');
copyFileSync(join(OUT, '10h.db'), webDb);
const db = new DatabaseSync(webDb);
db.exec("DELETE FROM chunk_vec; UPDATE meta SET value = 'static' WHERE key = 'phase'; VACUUM;");
db.close();
const dbBytes = statSync(webDb).size, dbMb = dbBytes / 1e6;
log(`database: ${dbMb.toFixed(1)} MB${dbMb > SIZE_BUDGET_MB ? ` — over the ${SIZE_BUDGET_MB} MB budget` : ''}`);

// The app shell. The database size drives the progress bar: the host may gzip the file, so Content-Length differs.
const html = readFileSync(join(APP, 'web', 'index.html'), 'utf8')
  .replace(/\n\s*<meta name="description"[^>]*>/, '')
  .replace(/\n\s*<a [^>]*data-local-only[^>]*>[^<]*<\/a>/g, '') // local tools (review); removing them later would shift the layout
  .replace('<title>10H Explorer</title>', `<title>10H Explorer</title>\n  ${headTags({ site: SITE, title: 'How Bayern got 10H', url: SITE, description: DESCRIPTION, ogType: 'website' })}`)
  .replace('href="styles.css"', 'href="web/styles.css"')
  .replace('<script type="module" src="src/main.ts"></script>',
    `<script>window.TENH_STATIC = { db: "10h-web.db", size: ${dbBytes}, vendor: new URL("vendor/sqlite-wasm/index.mjs", location.href).href };</script>\n  <script type="module" src="web/src/main.js"></script>`)
  .replace('</body>', `  ${footer('')}\n</body>`);
if (!html.includes('TENH_STATIC') || !html.includes('og:title')) throw new Error('web/index.html no longer matches the export');
writeFileSync(join(DIST, 'index.html'), html);

// The start page's numbers, so it renders without the database.
const webQueries = new Queries(new DatabaseSync(webDb, { readOnly: true }));
writeFileSync(join(DIST, 'meta.json'), JSON.stringify(webQueries.meta()));

// 4. Archived files (the reader shows them next to the text)
let files = 0, bytes = 0;
if (!args.has('--no-files')) {
  const src = new DatabaseSync(join(OUT, '10h.db'), { readOnly: true });
  for (const f of src.prepare('SELECT id FROM file').all() as Array<{ id: string }>) {
    const from = join(WIKI, f.id), to = join(DIST, 'files', f.id);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    files++; bytes += statSync(to).size;
  }
  src.close();
}
log(`files: ${files} (${(bytes / 1e6).toFixed(1)} MB)`);

// 5. JSON-LD dump of the graph
const ld = jsonld();
writeFileSync(join(DIST, '10h.jsonld'), JSON.stringify(ld, null, 1));

// 6. A plain page per entity, the index of all entries, sitemap.xml
const entities = new DatabaseSync(webDb, { readOnly: true }).prepare('SELECT id, type, label FROM entity ORDER BY id').all() as Array<{ id: string; type: string; label: string }>;
const pages = writeStaticPages(webQueries, entities, {
  site: SITE, dist: DIST, builtAt: webQueries.meta().built_at,
  jsonld: new Map(ld['@graph'].map((n) => [String(n['@id']).replace(/^tenh:/, ''), n])), context: ld['@context'],
});
log(`static pages: ${pages}`);
writeFileSync(join(DIST, '.nojekyll'), '');
log(`done: ${DIST}`);
if (dbMb > SIZE_BUDGET_MB) process.exitCode = 1;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));
}

// Entities with their statements. Types map to schema.org (and SKOS for concepts); predicates and statement details
// live in the "tenh" vocabulary. Wikidata links become owl:sameAs.
function jsonld(): { '@context': Record<string, string>; '@graph': Record<string, any>[] } {
  const src = new DatabaseSync(join(OUT, '10h.db'), { readOnly: true });
  const TYPES: Record<string, string> = { Person: 'schema:Person', Organization: 'schema:Organization', Document: 'schema:CreativeWork', Law: 'schema:Legislation',
    Place: 'schema:Place', Event: 'schema:Event', VoteEvent: 'schema:Event', Procedure: 'tenh:Procedure', Concept: 'skos:Concept' };
  const graph: Record<string, any>[] = [];
  const sameAs = new Map<string, string[]>();
  for (const r of src.prepare("SELECT entity_id, value FROM external_id WHERE scheme = 'wikidata' AND status = 'confirmed'").all() as Array<{ entity_id: string; value: string }>) {
    sameAs.set(r.entity_id, [...(sameAs.get(r.entity_id) ?? []), `http://www.wikidata.org/entity/${r.value}`]);
  }
  const stmts = src.prepare("SELECT * FROM statement WHERE subj = ? AND pred != 'cites'");
  const cites = src.prepare("SELECT obj FROM statement WHERE subj = ? AND pred = 'cites'");
  const ev = src.prepare('SELECT doc_id, page, locator, quote FROM evidence WHERE statement_id = ?');
  for (const e of src.prepare('SELECT id, type, label, props FROM entity ORDER BY id').all() as Array<Record<string, string>>) {
    const node: Record<string, any> = { '@id': `tenh:${e.id}`, '@type': TYPES[e.type] ?? 'schema:Thing', 'schema:name': e.label, 'schema:url': `${SITE}${pagePath(e.id)}` };
    if (sameAs.has(e.id)) node['owl:sameAs'] = sameAs.get(e.id)!.map((u) => ({ '@id': u }));
    const c = (cites.all(e.id) as Array<{ obj: string }>).map((x) => ({ '@id': `tenh:${x.obj}` }));
    if (c.length) node['tenh:cites'] = c;
    const st = (stmts.all(e.id) as Array<Record<string, any>>).map((s) => ({
      'tenh:predicate': `tenh:${s.pred}`, ...(s.obj ? { 'tenh:object': { '@id': `tenh:${s.obj}` } } : {}), ...(s.value ? { 'tenh:value': s.value } : {}),
      ...(s.start ? { 'tenh:start': s.start } : {}), ...(s.end ? { 'tenh:end': s.end } : {}), 'tenh:marker': s.marker,
      ...(s.rationale ? { 'tenh:rationale': s.rationale } : {}),
      'tenh:evidence': (ev.all(s.id) as Array<Record<string, any>>).map((x) => ({ 'tenh:document': x.doc_id ? { '@id': `tenh:${x.doc_id}` } : null, 'tenh:page': x.page, 'tenh:quote': x.quote })),
    }));
    if (st.length) node['tenh:statements'] = st;
    graph.push(node);
  }
  src.close();
  return { '@context': { schema: 'https://schema.org/', skos: 'http://www.w3.org/2004/02/skos/core#', owl: 'http://www.w3.org/2002/07/owl#', tenh: 'urn:10h:' }, '@graph': graph };
}
