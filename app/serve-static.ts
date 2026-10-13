// Preview the static export: node serve-static.ts [--port 8720]. Serves dist/ as a static host would (no API).
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { APP } from './build/lib/ctx.ts';

const DIST = join(APP, 'dist');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8720;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.json': 'application/json', '.jsonld': 'application/ld+json', '.db': 'application/octet-stream' };
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  const file = normalize(join(DIST, p === '/' ? 'index.html' : p));
  if (!(file + sep).startsWith(DIST + sep) && file !== join(DIST, 'index.html') || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Static export: http://localhost:${port}/`));
