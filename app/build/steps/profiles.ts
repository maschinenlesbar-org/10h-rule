// Step 4c: person data from abgeordnetenwatch.de and DIP. Reads the snapshot data/profiles.json (fetched with network by
// build/fetch-profiles.ts), so the build stays offline. People with an id but no entry in the snapshot are reported.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, log, type Ctx } from '../lib/ctx.ts';

export function profiles(ctx: Ctx): void {
  const { db, report } = ctx;
  const file = join(DATA, 'profiles.json');
  if (!existsSync(file)) { report.add('Person data', 'data/profiles.json is missing: run build/fetch-profiles.ts'); return; }
  const snap = JSON.parse(readFileSync(file, 'utf8')) as { fetched: string; people: Record<string, unknown> };
  const exists = db.prepare("SELECT 1 FROM entity WHERE id = ? AND type = 'Person'");
  const ins = db.prepare('INSERT INTO person_profile (entity_id, data) VALUES (?, ?)');
  let n = 0;
  for (const [id, data] of Object.entries(snap.people)) {
    if (!exists.get(id)) { report.add('Person data for unknown people (data/profiles.json)', id); continue; }
    ins.run(id, JSON.stringify(data));
    n++;
  }
  const missing = db.prepare(`SELECT DISTINCT x.entity_id FROM external_id x WHERE x.scheme IN ('abgeordnetenwatch', 'dip_person')
    AND x.entity_id NOT IN (SELECT entity_id FROM person_profile)`).all() as Array<{ entity_id: string }>;
  for (const m of missing) report.add('People with an abgeordnetenwatch or DIP id but no data (run build/fetch-profiles.ts)', m.entity_id);
  db.prepare("INSERT INTO meta (key, value) VALUES ('profiles_fetched', ?)").run(snap.fetched);
  report.count('People with abgeordnetenwatch or DIP data', n);
  log(`profiles: ${n} people (snapshot of ${snap.fetched})`);
}
