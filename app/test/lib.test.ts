import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docIdFromFilename, slug } from '../build/lib/ids.ts';
import { extractRefs, lawLabel } from '../build/lib/refs.ts';
import { mdTables, parseDate, markerOf, parseCsv } from '../build/lib/text.ts';

test('file names map to document ids', () => {
  const cases: Array<[string, string]> = [
    ['BT-Drs_18-1310.pdf', 'doc/bt-drs-18-1310'],
    ['BT-PlPr_18-44.pdf', 'doc/bt-plpr-18-44'],
    ['BR-Drs_155-14B.pdf', 'doc/br-drs-155-14-b'],
    ['BR-Drs_155-1-14.pdf', 'doc/br-drs-155-1-14'],
    ['BR-PlPr_922.pdf', 'doc/br-plpr-922'],
    ['BY-Drs_17-542_SA.pdf', 'doc/by-drs-17-542'],
    ['BY-PlPr_17-29_Auszug-Gesetzentwurf-2137.pdf', 'doc/by-plpr-17-29'],
    ['SN-Drs_5-14898_Antwort.pdf', 'doc/sn-drs-5-14898'],
    ['SN-APr_6-5-3A_Anhoerung-Drs-6-466.pdf', 'doc/sn-apr-6-5-3a'],
    ['WD-7-042-19.pdf', 'doc/wd-7-042-19'],
    ['BayVerfGH_2016-05-09_Vf-14-VII-14.pdf', 'doc/bayverfgh-vf-14-vii-14'],
    ['Koalitionsvertrag_CDU-CSU-SPD_2013.pdf', 'doc/koalitionsvertrag-cdu-csu-spd-2013'],
  ];
  for (const [file, id] of cases) assert.equal(docIdFromFilename(file), id, file);
});

test('slug transliterates umlauts', () => {
  assert.equal(slug('Länderöffnungsklausel nach § 249'), 'laenderoeffnungsklausel-nach-249');
});

test('references resolve to the same ids as files', () => {
  const ids = (t: string, ctx: Parameters<typeof extractRefs>[1] = null) => extractRefs(t, ctx).map((r) => r.id);
  assert.deepEqual(ids('siehe BT-Drs 18/1310 und BR-Drs 155/14(B)'), ['doc/bt-drs-18-1310', 'doc/br-drs-155-14-b']);
  assert.deepEqual(ids('Bundesratsdrucksache 155/1/14'), ['doc/br-drs-155-1-14']);
  assert.deepEqual(ids('BY Drs 17/2137, LT-Drs 17/554, SN Drs 5/14898'), ['doc/by-drs-17-2137', 'doc/by-drs-17-554', 'doc/sn-drs-5-14898']);
  assert.deepEqual(ids('WD 7 - 3000 - 042/19 und WD 3-120/14'), ['doc/wd-7-042-19', 'doc/wd-3-120-14']);
  assert.deepEqual(ids('PlPr 18/44, BR-PlPr 922'), ['doc/bt-plpr-18-44', 'doc/br-plpr-922']);
  assert.deepEqual(ids('Vf. 14-VII-14'), ['doc/bayverfgh-vf-14-vii-14']);
  // Bare numbers need context, and the Wahlperiode must fit the parliament
  assert.deepEqual(ids('Drucksache 17/554'), [null]);
  assert.deepEqual(ids('Drucksache 17/554', 'by'), ['doc/by-drs-17-554']);
  assert.deepEqual(ids('Drucksache 155/14', 'br'), ['doc/br-drs-155-14']);
  assert.deepEqual(ids('Drs. 6/466', 'sn'), ['doc/sn-drs-6-466']);
  assert.deepEqual(ids('Drucksache 13/4978', 'bt'), [null]);
  assert.deepEqual(ids('BT-Drs. 13/4978'), ['doc/bt-drs-13-4978']);
  // Line breaks inside a reference
  assert.deepEqual(ids('Bundestags-\ndrucksache 18/1310'), ['doc/bt-drs-18-1310']);
});

test('law references', () => {
  const ids = (t: string) => extractRefs(t, null).map((r) => r.id);
  assert.deepEqual(ids('§ 249 Abs. 3 BauGB'), ['law/baugb-249-3']);
  assert.deepEqual(ids('§ 35 Absatz 1 Nummer 5 BauGB'), ['law/baugb-35-1-5']);
  assert.deepEqual(ids('Art. 82 BayBO'), ['law/baybo-82']);
  assert.deepEqual(ids('Art. 51 Abs. 2 SächsVerf'), ['law/saechsverf-51-2']);
  assert.equal(lawLabel('law/baugb-249-3'), '§ 249 Abs. 3 BauGB');
  assert.equal(lawLabel('law/baybo-82'), 'Art. 82 BayBO');
});

test('markdown tables keep links with pipes and parentheses intact', () => {
  const [t] = mdTables('# H\n\n| A | B |\n| --- | --- |\n| [x (y)](http://e.org/a|b) | 1 (open |\n');
  assert.equal(t.heading, 'H');
  assert.deepEqual(t.rows[0], ['[x (y)](http://e.org/a|b)', '1 (open']);
});

test('dates', () => {
  assert.deepEqual(parseDate('05.03.2013'), { iso: '2013-03-05', precision: 'day' });
  assert.deepEqual(parseDate('05./06.11.2015'), { iso: '2015-11-05', end: '2015-11-06', precision: 'day' });
  assert.deepEqual(parseDate('10.07.–06.11.2014'), { iso: '2014-07-10', end: '2014-11-06', precision: 'day' });
  assert.deepEqual(parseDate('01/2015'), { iso: '2015-01', precision: 'month' });
  assert.deepEqual(parseDate('Aug 2013'), { iso: '2013-08', precision: 'month' });
  assert.equal(parseDate('Spring 2013'), null);
});

test('markers', () => {
  assert.equal(markerOf('x **[secondary]**'), 'secondary');
  assert.equal(markerOf('x **[not verified]**'), 'unverified');
  assert.equal(markerOf('x'), 'primary');
});

test('csv', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
});
