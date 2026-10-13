// Static entity pages of the export (skipped when out/10h.db does not exist yet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OUT } from '../build/lib/ctx.ts';
import { Queries } from '../server/queries.ts';
import { writeStaticPages } from '../export-pages.ts';

const DB = join(OUT, '10h.db');
test('static pages carry the facts, the head tags and the JSON-LD', { skip: !existsSync(DB) && 'run npm run build first' }, () => {
  const dist = mkdtempSync(join(tmpdir(), '10h-pages-'));
  try {
    const q = new Queries(new DatabaseSync(DB, { readOnly: true }));
    const site = 'https://example.org/10h/';
    const entities = [{ id: 'person/florian-pronold', type: 'Person', label: 'Florian Pronold' }, { id: 'vote/2014-06-27-bundestag-465-114', type: 'VoteEvent', label: 'Bundestag' }];
    const node = { '@id': 'tenh:person/florian-pronold', 'schema:name': 'Florian Pronold </script><b>' };
    writeStaticPages(q, entities, { site, dist, builtAt: '2026-10-13T00:00:00Z', jsonld: new Map([['person/florian-pronold', node]]), context: {} });

    const page = readFileSync(join(dist, 'e/person/florian-pronold/index.html'), 'utf8');
    assert.match(page, /<link rel="canonical" href="https:\/\/example.org\/10h\/e\/person\/florian-pronold\/">/);
    assert.match(page, /<meta property="og:image" content="https:\/\/example.org\/10h\/og.png">/);
    assert.match(page, /<link rel="stylesheet" href="..\/..\/..\/web\/styles.css">/, 'paths are relative to the page');
    assert.match(page, /href="..\/..\/..\/e\/doc\/bt-drs-18-268\/">BT Drs 18\/268<\/a>/, 'facts link to the other entries');
    assert.ok(page.includes('<\\/script><b>') && !page.includes('</script><b>'), 'JSON-LD cannot close its script element');
    assert.match(page, /href="..\/..\/..\/#\/e\/person\/florian-pronold"/, 'links into the app');
    assert.match(page, /<meta name="description" content="Florian Pronold \(SPD\): person in the record/);

    const vote = readFileSync(join(dist, 'e/vote/2014-06-27-bundestag-465-114/index.html'), 'utf8');
    assert.match(vote, /<th scope="row">Total<\/th><td class="num">465<\/td><td class="num">114<\/td><td class="num">3<\/td>/);

    const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes('<loc>https://example.org/10h/e/person/florian-pronold/</loc>'));
    assert.ok(readFileSync(join(dist, 'e/index.html'), 'utf8').includes('href="../e/person/florian-pronold/"'));
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
