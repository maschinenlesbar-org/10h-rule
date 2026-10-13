// Query tests against the built database (skipped when out/10h.db does not exist yet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OUT } from '../build/lib/ctx.ts';
import { Queries } from '../server/queries.ts';

test('user input becomes a safe FTS5 query', () => {
  assert.equal(Queries.ftsQuery('10H Regelung'), '"10H" AND "Regelung"');
  assert.equal(Queries.ftsQuery('"nicht in Anspruch" Wind*'), '"nicht in Anspruch" AND "Wind"*');
  assert.equal(Queries.ftsQuery('a"b OR c'), '"a""b" AND "OR" AND "c"'); // operators and quotes are literal text
  assert.equal(Queries.ftsQuery('   '), '');
});

const DB = join(OUT, '10h.db');
test('queries against the built database', { skip: !existsSync(DB) && 'run npm run build first' }, async () => {
  const q = new Queries(new DatabaseSync(DB, { readOnly: true }));

  const s = await q.search('Kernbereich exekutiver Eigenverantwortung', {}, 'keyword');
  const docs = s.hits.map((h) => h.doc.id);
  assert.ok(docs.includes('doc/sn-drs-5-14898') && docs.includes('doc/sn-drs-6-466'), 'OCR text of the Saxon scans is searchable');

  const tenH = await q.search('10H', {}, 'keyword');
  assert.ok(tenH.expandedWith.includes('10-H-Regelung'), 'concept aliases expand the query');
  assert.ok(tenH.facets.parliament.some((f) => f.value === 'by'));
  assert.ok((await q.search('BT-Drs 18/1310', {}, 'keyword')).entities.some((e) => e.id === 'doc/bt-drs-18-1310'), 'typed references resolve');

  const pronold = q.entity('person/florian-pronold')!;
  const answered = pronold.facts.filter((f) => f.pred === 'answered').map((f) => f.other!.id).sort();
  assert.deepEqual(answered, ['doc/bt-drs-18-1590', 'doc/bt-drs-18-1684', 'doc/bt-drs-18-268', 'doc/bt-drs-18-680']);
  assert.ok(pronold.external.some((x) => x.scheme === 'wikidata' && x.status === 'confirmed'));

  const page = q.page('anfragen/sachsen/SN-Drs_5-14898_Antwort.pdf', 3)!;
  assert.equal(page.read_via, 'ocr');
  for (const sp of page.spans) assert.ok(page.text.slice(sp.start, sp.end).length > 0, 'spans point into the page text');
  assert.equal(q.page('../../CLAUDE.md', 1), null);
});

test('roll calls, procedures and story (phase 3)', { skip: !existsSync(DB) && 'run npm run build first' }, () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const q = new Queries(db);
  // Individual votes add up to the protocol totals.
  for (const v of db.prepare('SELECT id, yes, no, abstain FROM vote_event').all() as Array<{ id: string; yes: number; no: number; abstain: number }>) {
    const c = Object.fromEntries((db.prepare('SELECT option, count(*) n FROM vote WHERE vote_event_id = ? GROUP BY option').all(v.id) as Array<{ option: string; n: number }>).map((r) => [r.option, r.n]));
    assert.deepEqual([c.yes ?? 0, c.no ?? 0, c.abstain ?? 0], [v.yes, v.no, v.abstain], v.id);
  }
  // The coalition members who did not vote yes on the clause (wiki, bund-2014.md).
  const clause = q.entity('vote/2014-06-27-bundestag-465-114')!.rollcall!;
  assert.deepEqual(clause.deviators.map((d) => `${d.name}:${d.option}`).sort(),
    ['Dr. Simone Raatz:abstain', 'Ewald Schurer:abstain', 'Josef Göppel:no', 'Marco Bülow:no', 'Martina Stamm-Fibich:abstain', 'Peter Stein:no']);
  const federal = q.entity('procedure/bund-laenderoeffnungsklausel')!.procedure!;
  assert.ok(federal.steps.length >= 10 && federal.steps[0].date === '2014-04-08');
  assert.ok(!federal.steps.some((s) => s.docs.some((d) => d.id === 'doc/bt-drs-18-33')), 'no protocol number read as a Drucksache');
  const story = q.story();
  assert.equal(story.links.length, 5);
  assert.ok(story.links.every((l) => l.evidence.length && l.marker === 'primary'), 'every interpretive link has located evidence');
});

test('questions, effects and Länder (phase 4)', { skip: !existsSync(DB) && 'run npm run build first' }, () => {
  const q = new Queries(new DatabaseSync(DB, { readOnly: true }));
  const by = q.questions().filter((r) => r.parliament === 'by');
  assert.ok(by.length && by.every((r) => r.answerer), 'every Bavarian question has its answering ministry');
  // Quarterly and yearly approvals come from the same answer (BY Drs 17/12258) and must agree.
  const obs = q.observations().filter((o) => o.verified && o.metric === 'approvals' && o.place?.id === 'place/bayern' && o.doc.id === 'doc/by-drs-17-12258');
  for (const year of ['2012', '2013', '2014', '2015']) {
    const annual = obs.find((o) => o.period_start === `${year}-01-01` && o.period_end === `${year}-12-31`);
    const quarters = obs.filter((o) => o.period_start!.startsWith(year) && o.period_end!.startsWith(year) && o !== annual);
    assert.ok(annual && quarters.length === 4, `approvals ${year}: one year and four quarters`);
    assert.equal(quarters.reduce((n, o) => n + Number(o.value), 0), Number(annual.value), `approvals ${year}`);
  }
  const used = q.laender().filter((l) => l.status === 'used').map((l) => l.land.id);
  assert.deepEqual(used, ['place/bayern'], 'only Bayern used § 249 Abs. 3 BauGB');

  const bib = q.bibliography();
  const byLabel = (l: string) => bib.find((b) => b.label === l);
  const bverwg = byLabel('BVerwG, Urteil vom 29.08.2007, 4 C 2.07')!;
  assert.equal(bverwg.kind, 'court');
  assert.ok(new Set(bverwg.citations.map((c) => c.doc.id)).size >= 3, 'one decision, cited as 4 C 2/07 and 4 C 2.07');
  assert.ok(bverwg.citations.every((c) => c.page > 0 && c.file_id), 'every citation has its page');
  assert.ok(byLabel('BGBl. I 2004 S. 2414'), 'gazette year from the date before the citation');
  assert.ok(!bib.some((b) => b.label === 'www.bayern.landtag.de'), 'footers are left out');
  assert.ok(!bib.some((b) => b.label === 'GVBl. 2014 S. 478'), 'archived works are part of the record, not the bibliography');
  assert.ok(bib.some((b) => b.kind === 'parliamentary' && b.entity && !b.citations.every((c) => c.on_topic)), 'unrelated pages are flagged');
  // Person data from abgeordnetenwatch and DIP (data/profiles.json).
  const pr = q.entity('person/florian-pronold')!;
  assert.equal(pr.profile?.abgeordnetenwatch?.year_of_birth, 1972);
  const bt18 = pr.profile!.abgeordnetenwatch!.mandates.find((m) => m.period === 'Bundestag 2013 - 2017')!;
  assert.equal(bt18.list_position, 1);
  assert.ok(bt18.committees, 'committees fetched for periods that overlap the story');
  assert.ok(pr.profile!.dip!.roles.some((r) => /Umwelt, Naturschutz, Bau und Reaktorsicherheit/.test(r.ressort ?? '')), 'ministry from DIP');
  assert.ok(pr.profile!.dip!.activities.total > 400, 'DIP activities 2012–2016');
  assert.equal(pr.external.find((x) => x.scheme === 'abgeordnetenwatch')?.url, 'https://www.abgeordnetenwatch.de/profile/florian-pronold', 'profile page, not the API');
  assert.ok(q.list('people').some((r) => r.id === 'person/florian-pronold' && r.cols.born === 1972));

  const works = q.entity('doc/bb-pbd-2016-02-29-mindestabstand-windkraft')!.works!;
  assert.ok(works.some((w) => w.label === bverwg.label && w.pages.length), 'a document lists the works it cites');
});
