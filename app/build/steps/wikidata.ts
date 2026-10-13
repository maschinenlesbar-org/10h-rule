// Step 3a: same_as links to Wikidata, cached in data/wikidata.csv (the cache is committed and reviewed by hand).
// - People with an abgeordnetenwatch id are matched through Wikidata property P5355: exact, so "confirmed".
// - Everything else is matched by label search and stored as "unverified" until a person flips it to "confirmed"
//   (or "rejected") in the CSV.

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, log, type Ctx } from '../lib/ctx.ts';
import { readCsv, toCsv } from '../lib/text.ts';

const CACHE_FILE = join(DATA, 'wikidata.csv');
const COLS = ['entity_id', 'qid', 'status', 'method', 'wikidata_label', 'wikidata_description'];
const UA = '10h-explorer-build/0.1 (research project; https://github.com/)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = Record<string, string>;

// GET with retries: honours Retry-After on 429/503, otherwise backs off exponentially.
async function get(url: string, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      await sleep(Math.min(wait, 120_000));
      continue;
    }
    throw new Error(`${res.status} for ${url.slice(0, 80)}`);
  }
}

async function sparql(query: string): Promise<Array<Record<string, string>>> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const res = await get(url, { Accept: 'application/sparql-results+json' });
  const json = (await res.json()) as { results: { bindings: Array<Record<string, { value: string }>> } };
  return json.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

async function search(label: string): Promise<Array<{ id: string; label: string; description?: string }>> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=de&uselang=de&limit=5&search=${encodeURIComponent(label)}`;
  const res = await get(url, {});
  return ((await res.json()) as { search: Array<{ id: string; label: string; description?: string }> }).search;
}

export async function wikidata(ctx: Ctx): Promise<void> {
  const { db, report, opts } = ctx;
  const cache = new Map<string, Row>();
  if (existsSync(CACHE_FILE)) for (const r of readCsv(CACHE_FILE)) cache.set(r.entity_id, r);

  // Whole laws only (law/baugb), not single paragraphs (law/baugb-249-3), which have no Wikidata items.
  const entities = (db.prepare(`SELECT id, type, label FROM entity WHERE type IN ('Person','Organization','Place','Law') ORDER BY id`)
    .all() as Array<{ id: string; type: string; label: string }>).filter((e) => e.type !== 'Law' || !/-\d/.test(e.id));
  const missing = entities.filter((e) => !cache.has(e.id));
  const save = () => writeFileSync(CACHE_FILE, toCsv([...cache.values()].sort((a, b) => a.entity_id.localeCompare(b.entity_id)), COLS));

  if (missing.length && !opts.network) {
    report.add('Entities without a Wikidata lookup (run with network)', `${missing.length} entities`);
  } else if (missing.length) {
    try {
      await lookup(ctx, missing, cache, save);
    } catch (err) {
      report.add('Wikidata lookup failed (build continued with the cache)', String(err));
      log(`wikidata: lookup failed, continuing with the cache: ${err}`);
    } finally {
      save();
    }
  }

  const ins = db.prepare("INSERT OR IGNORE INTO external_id (entity_id, scheme, value, status, method) VALUES (?, 'wikidata', ?, ?, ?)");
  const known = new Set(entities.map((e) => e.id));
  let confirmed = 0, unverified = 0;
  for (const r of cache.values()) {
    if (!known.has(r.entity_id) || !r.qid || r.status === 'rejected' || r.status === 'not_found') continue;
    ins.run(r.entity_id, r.qid, r.status === 'confirmed' ? 'confirmed' : 'unverified', r.method);
    if (r.status === 'confirmed') confirmed++; else { unverified++; report.add('Wikidata links to review (data/wikidata.csv)', `${r.entity_id} → ${r.qid} ${r.wikidata_label} (${r.wikidata_description})`); }
  }
  report.count('Wikidata links confirmed', confirmed);
  report.count('Wikidata links unverified', unverified);
  log(`wikidata: ${confirmed} confirmed, ${unverified} unverified`);
}

async function lookup(ctx: Ctx, missing: Array<{ id: string; type: string; label: string }>, cache: Map<string, Row>, save: () => void): Promise<void> {
  const { db, opts } = ctx;
  // People by abgeordnetenwatch id
  const aw = db.prepare("SELECT entity_id, value FROM external_id WHERE scheme = 'abgeordnetenwatch'").all() as Array<{ entity_id: string; value: string }>;
  const wanted = aw.filter((a) => missing.some((m) => m.id === a.entity_id) || opts.refreshWikidata);
  for (let i = 0; i < wanted.length; i += 50) {
    const batch = wanted.slice(i, i + 50);
    const rows = await sparql(`SELECT ?item ?aw ?itemLabel ?itemDescription WHERE {
      VALUES ?aw { ${batch.map((b) => `"${b.value}"`).join(' ')} } ?item wdt:P5355 ?aw .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". } }`);
    for (const r of rows) {
      const who = batch.find((b) => b.value === r.aw)!;
      cache.set(who.entity_id, { entity_id: who.entity_id, qid: r.item.replace(/.*\//, ''), status: 'confirmed', method: 'P5355 abgeordnetenwatch id',
        wikidata_label: r.itemLabel ?? '', wikidata_description: r.itemDescription ?? '' });
    }
    await sleep(500);
  }
  save();
  // Everything else by label search, one request per second
  let n = 0;
  for (const e of missing.filter((m) => !cache.has(m.id))) {
    const hits = await search(e.label);
    await sleep(1000);
    const want = e.type === 'Person' ? hits.find((h) => /Politiker|politician/i.test(h.description ?? '')) : hits.find((h) => h.label === e.label) ?? hits[0];
    cache.set(e.id, want
      ? { entity_id: e.id, qid: want.id, status: 'unverified', method: 'label search', wikidata_label: want.label, wikidata_description: want.description ?? '' }
      : { entity_id: e.id, qid: '', status: 'not_found', method: 'label search', wikidata_label: '', wikidata_description: '' });
    if (++n % 20 === 0) save();
  }
}
