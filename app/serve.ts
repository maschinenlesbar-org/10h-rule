// Local server: node serve.ts [--port 8710] [--review]
// Serves the app (web/), a JSON API over out/10h.db, and the archived PDFs. Binds to 127.0.0.1 only, and answers only
// requests addressed to localhost (a page that rebinds its own domain to 127.0.0.1 still sends its own Host).
// --review opens the database writable and enables POST /api/review (decisions also go to data/mention-review.csv).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, writeFileSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { APP, WIKI, DATA, OUT } from './build/lib/ctx.ts';
import { readCsv, toCsv } from './build/lib/text.ts';
import { Queries } from './server/queries.ts';
import { embed, embedder } from './build/lib/embed.ts';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 8710;
const reviewMode = args.includes('--review');
const DB_PATH = join(OUT, '10h.db');
if (!existsSync(DB_PATH)) {
  console.error('out/10h.db not found. Run `npm run build` first.');
  process.exit(1);
}
const db = new DatabaseSync(DB_PATH, { readOnly: !reviewMode });
const q = new Queries(db);
q.reviewWritable = reviewMode;
// Semantic search: load the embedding model in the background; until it is ready, search is keyword-only.
if (q.hasVectors && !args.includes('--no-semantic')) {
  embedder().then(() => {
    q.embedQuery = async (text) => (await embed([text], 'query'))[0];
    console.log('Semantic search ready.');
  }).catch((err) => console.error('Semantic search unavailable:', String(err)));
}
const WEB = join(APP, 'web');
const HOSTS = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.json': 'application/json' };

const tsCache = new Map<string, { mtime: number; js: string }>();
function serveStatic(res: ServerResponse, root: string, rel: string): void {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root + sep) || !existsSync(path) || !statSync(path).isFile()) return notFound(res);
  const ext = extname(path);
  if (ext === '.ts') {
    // Browser gets the TypeScript source with types stripped (positions kept, so stack traces match the source).
    const mtime = statSync(path).mtimeMs;
    let c = tsCache.get(path);
    if (!c || c.mtime !== mtime) {
      c = { mtime, js: stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' }) };
      tsCache.set(path, c);
    }
    res.writeHead(200, { 'Content-Type': TYPES['.ts'], 'Cache-Control': 'no-cache' });
    res.end(c.js);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(path).pipe(res);
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}
function notFound(res: ServerResponse): void { json(res, { error: 'not found' }, 404); }

async function body(req: IncomingMessage): Promise<any> {
  let s = '';
  for await (const chunk of req) { s += chunk; if (s.length > 1e5) throw new Error('body too large'); }
  return JSON.parse(s || '{}');
}

const REVIEW_CSV = join(DATA, 'mention-review.csv');
const REVIEW_COLS = ['entity_id', 'surface', 'status', 'scope', 'reviewed_at', 'reviewer', 'note'];
function recordReview(entityId: string, surface: string, status: string): void {
  const rows = existsSync(REVIEW_CSV) ? readCsv(REVIEW_CSV) : [];
  // A decision from the app is general (no scope); scoped rows for the same surface are kept.
  const keep = rows.filter((r) => !(r.entity_id === entityId && r.surface === surface && !r.scope));
  if (status !== 'auto') keep.push({ entity_id: entityId, surface, status, scope: '', reviewed_at: new Date().toLocaleDateString('sv-SE'), reviewer: 'app', note: '' });
  keep.sort((a, b) => a.entity_id.localeCompare(b.entity_id) || a.surface.localeCompare(b.surface) || (a.scope ?? '').localeCompare(b.scope ?? ''));
  writeFileSync(REVIEW_CSV, toCsv(keep, REVIEW_COLS));
}

createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host ?? '')) return json(res, { error: 'unknown host' }, 403);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    const s = url.searchParams;
    if (p === '/api/meta') return json(res, q.meta());
    if (p === '/api/story') return json(res, q.story());
    if (p === '/api/questions') return json(res, q.questions());
    if (p === '/api/observations') return json(res, q.observations());
    if (p === '/api/laender') return json(res, q.laender());
    if (p === '/api/bibliography') return json(res, q.bibliography());
    if (p === '/api/search') return json(res, await q.search(s.get('q') ?? '', { kind: s.get('kind') ?? '', parliament: s.get('parliament') ?? '', year: s.get('year') ?? '' },
      s.get('mode') === 'keyword' ? 'keyword' : 'hybrid'));
    if (p === '/api/similar' && s.get('doc')) return json(res, q.similarDocs(s.get('doc')!));
    if (p === '/api/similar' && s.get('file')) return json(res, q.similarPassages(s.get('file')!, Number(s.get('n')) || 1));
    if (p === '/api/entity') { const e = q.entity(s.get('id') ?? ''); return e ? json(res, e) : notFound(res); }
    if (p === '/api/page') { const v = q.page(s.get('file') ?? '', Number(s.get('n')) || 1); return v ? json(res, v) : notFound(res); }
    if (p === '/api/list') return json(res, q.list(s.get('kind') ?? ''));
    if (p === '/api/review' && req.method === 'GET') return json(res, q.review(s.get('type') ?? '', s.get('status') ?? 'auto'));
    if (p === '/api/review' && req.method === 'POST') {
      // Writes come only from this app. A JSON content type makes browsers send a CORS preflight, which this server
      // never grants, and browsers send an Origin with every POST: it must be this server.
      const origin = req.headers.origin;
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '') || (origin !== undefined && origin !== `http://${req.headers.host}`)) {
        return json(res, { error: 'forbidden' }, 403);
      }
      if (!reviewMode) return json(res, { error: 'start the server with --review to record decisions' }, 403);
      const b = await body(req);
      if (!['confirmed', 'rejected', 'auto'].includes(b.status) || typeof b.entity_id !== 'string' || typeof b.surface !== 'string') return json(res, { error: 'bad request' }, 400);
      const changed = q.setReview(b.entity_id, b.surface, b.status);
      // Only decisions on mentions that exist reach data/mention-review.csv, which is committed and drives the build.
      if (!changed) return json(res, { error: 'no mentions with this entity and surface form' }, 404);
      recordReview(b.entity_id, b.surface, b.status);
      return json(res, { changed });
    }
    if (p.startsWith('/files/')) {
      const fileId = decodeURIComponent(p.slice('/files/'.length));
      return q.fileExists(fileId) ? serveStatic(res, WIKI, fileId) : notFound(res); // only archived files
    }
    if (p === '/' || !extname(p)) return serveStatic(res, WEB, 'index.html');
    return serveStatic(res, WEB, decodeURIComponent(p.slice(1)));
  } catch (err) {
    console.error(err);
    json(res, { error: 'internal error, see the server log' }, 500); // details stay in the log
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`10H Explorer: http://localhost:${port}/${reviewMode ? '  (review mode: decisions are saved)' : ''}`);
});
