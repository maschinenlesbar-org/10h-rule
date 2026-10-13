// Golden test for the wiki parser: runs steps 1, 3 and 4 against the real wiki and compares the statements with
// test/golden/wiki-statements.json. When the wiki changes on purpose, review the diff and regenerate with
// UPDATE_GOLDEN=1 npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFresh } from '../build/lib/db.ts';
import { Report, type Ctx } from '../build/lib/ctx.ts';
import { inventory } from '../build/steps/inventory.ts';
import { seed } from '../build/steps/seed.ts';
import { wiki } from '../build/steps/wiki.ts';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'wiki-statements.json');

test('wiki statements match the golden file', () => {
  const ctx: Ctx = { db: openFresh(':memory:'), opts: { ocr: false, network: false, refreshWikidata: false, embed: false }, report: new Report() };
  inventory(ctx);
  seed(ctx);
  wiki(ctx);
  const rows = ctx.db.prepare(`SELECT subj, pred, obj, value, start, marker FROM statement WHERE method IN ('wiki','dictionary')
                               ORDER BY subj, pred, obj, value`).all().map((r) => ({ ...r }));
  if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(rows, null, 1) + '\n');
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const key = (r: Record<string, unknown>) => JSON.stringify(r);
  const have = new Set(rows.map(key)), want = new Set(golden.map(key));
  const missing = golden.filter((r: Record<string, unknown>) => !have.has(key(r)));
  const extra = rows.filter((r) => !want.has(key(r)));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, 'wiki statements changed; review and regenerate with UPDATE_GOLDEN=1');
});
