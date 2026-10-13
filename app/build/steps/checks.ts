// Step 11: integrity checks. Failures are listed in the report; hard failures make the build exit non-zero.

import { log, type Ctx } from '../lib/ctx.ts';

// Roll-call totals that must match the protocols (yes, no, abstain).
const EXPECTED_VOTES: Array<[string, number, number, number]> = [
  ['Bundestag 27.06.2014, Länderöffnungsklausel (PlPr 18/44)', 465, 114, 3],
  ['Bundestag 27.06.2014, Entschließungsantrag 18/1903 (PlPr 18/44)', 108, 467, 0],
  ['Bayerischer Landtag 05.02.2014, Antrag 17/554 (PlPr 17/10)', 96, 66, 1],
  ['Bayerischer Landtag 12.11.2014, 10H law (PlPr 17/29)', 92, 63, 0],
];

export function checks(ctx: Ctx): number {
  const { db, report } = ctx;
  let failures = 0;
  const fail = (section: string, line: string) => { report.add(section, line); failures++; };

  const dangling = db.prepare(`SELECT s.id, s.subj, s.pred, s.obj, s.source FROM statement s
    WHERE s.subj NOT IN (SELECT id FROM entity) OR (s.obj IS NOT NULL AND s.obj NOT IN (SELECT id FROM entity))`).all() as Array<Record<string, string>>;
  for (const d of dangling) fail('FAIL: statements pointing to unknown entities', `${d.subj} ${d.pred} ${d.obj} (${d.source})`);

  for (const [label, yes, no, abst] of EXPECTED_VOTES) {
    const hit = db.prepare('SELECT id FROM vote_event WHERE yes = ? AND no = ? AND abstain = ?').get(yes, no, abst);
    if (!hit) fail('FAIL: roll-call totals missing or different from the protocol', `${label}: ${yes} : ${no} : ${abst}`);
  }

  const noFiles = db.prepare('SELECT count(*) n FROM file WHERE pages IS NULL OR pages = 0').get() as { n: number };
  if (noFiles.n) fail('FAIL: files without pages', `${noFiles.n} files`);

  const notArchived = db.prepare(`SELECT d.id, count(s.id) n FROM document d LEFT JOIN statement s ON s.obj = d.id
    WHERE d.archived = 0 GROUP BY d.id ORDER BY n DESC`).all() as Array<{ id: string; n: number }>;
  report.count('Referenced documents not in the archive', notArchived.length);
  for (const d of notArchived.slice(0, 40)) report.add('Most-cited documents not in the archive', `${d.id} (${d.n} statements)`);

  const markers = db.prepare('SELECT marker, count(*) n FROM statement GROUP BY marker').all() as Array<{ marker: string; n: number }>;
  for (const m of markers) report.count(`Statements marked ${m.marker}`, m.n);
  const types = db.prepare('SELECT type, count(*) n FROM entity GROUP BY type ORDER BY n DESC').all() as Array<{ type: string; n: number }>;
  for (const t of types) report.count(`Entities: ${t.type}`, t.n);

  log(`checks: ${failures} failures`);
  return failures;
}
