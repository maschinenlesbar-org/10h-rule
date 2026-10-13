// The local server refuses requests that do not come from its own app (skipped when out/10h.db does not exist yet).
// The server runs without --review: the checks come before the review-mode check, so nothing is ever written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP, OUT } from '../build/lib/ctx.ts';

const DB = join(OUT, '10h.db');
test('the server answers only its own host and origin', { skip: !existsSync(DB) && 'run npm run build first' }, async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(APP, 'serve.ts'), '--no-semantic', '--port', String(port)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(`${base}/api/meta`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const post = (headers: Record<string, string>) => fetch(`${base}/api/review`, { method: 'POST', headers,
      body: JSON.stringify({ entity_id: 'concept/10h', surface: '10H', status: 'rejected' }) }).then(async (r) => [r.status, (await r.json()).error]);

    assert.equal((await fetch(`${base}/api/meta`)).status, 200);
    // fetch() does not let a script set Host; node:http does.
    const { request } = await import('node:http');
    const rebound = await new Promise<number>((resolve) => request({ host: '127.0.0.1', port, path: '/api/meta', headers: { Host: `evil.example:${port}` } },
      (r) => { r.resume(); resolve(r.statusCode!); }).end());
    assert.equal(rebound, 403, 'DNS rebinding: a foreign Host is refused');

    assert.deepEqual(await post({ 'Content-Type': 'text/plain', Origin: 'https://evil.example' }), [403, 'forbidden'], 'cross-site simple request');
    assert.deepEqual(await post({ 'Content-Type': 'application/json', Origin: 'https://evil.example' }), [403, 'forbidden'], 'foreign origin');
    assert.deepEqual(await post({ 'Content-Type': 'text/plain' }), [403, 'forbidden'], 'not JSON');
    assert.deepEqual(await post({ 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }),
      [403, 'start the server with --review to record decisions'], 'the app itself passes the checks');
  } finally {
    server.kill();
  }
});
