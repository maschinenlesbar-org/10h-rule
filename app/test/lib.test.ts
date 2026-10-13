import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docIdFromFilename, slug } from '../build/lib/ids.ts';
import { extractWorks, isoDate, onTopic } from '../build/lib/biblio.ts';
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

test('bibliography: court decisions, by file number or collection, with aliases', () => {
  const one = (t: string) => extractWorks(t).map((w) => [w.kind, w.label, w.key]);
  assert.deepEqual(one('vgl. BVerwG, Urt. vom 29. Aug. 2007, Az. 4 C 2/07, juris'),
    [['court', 'BVerwG, Urteil vom 29.08.2007, 4 C 2/07', 'court|BVerwG|4 C 2.07']]);
  assert.equal(extractWorks('Bundesverwaltungsgericht (BVerwG), Urteil vom 29. August 2007, Az.: 4 C 2.07')[0].key, 'court|BVerwG|4 C 2.07', 'same file number');
  assert.equal(extractWorks('OVG Schleswig, Urteil vom 20. Januar 2015, Az. 1 KN 6/13')[0].label, 'OVG Schleswig-Holstein, Urteil vom 20.01.2015, 1 KN 6/13');
  assert.deepEqual(one('(vgl. BVerfGE 124, 161, 193 f.)'), [['court', 'BVerfGE 124, 161', 'court|BVerfGE 124, 161']]);
  assert.deepEqual(one('VGH Mannheim, ZfBR 2016, 159'), [['court', 'VGH BW, ZfBR 2016, 159', 'court|VGH BW|ZfBR 2016, 159']], 'a decision printed in a journal');
  // Not citations: proceedings in permit tables, ministry file numbers.
  assert.deepEqual(extractWorks('Antrag auf Nichtzulassung der Berufung beim VGH anhängig; durch BayVGH am 06.10.2014'), []);
  assert.deepEqual(extractWorks('Schreiben vom 3. September 2014 (Az.: IB1-1404.2-112)'), []);
  assert.equal(isoDate('7. März 2016'), '2016-03-07');
  assert.equal(isoDate('17.10.13'), '2013-10-17');
});

test('bibliography: literature, legislation and web sources', () => {
  const labels = (t: string) => extractWorks(t).map((w) => `${w.kind}: ${w.label}`);
  assert.deepEqual(labels('vgl. Grüner, NVwZ 2015, 108/110 f.'), ['literature: Grüner, NVwZ 2015, 108']);
  assert.deepEqual(labels('Windenergie auf dem Prüfstand, NVwZ 2015, S. 1093'), ['literature: NVwZ 2015, 1093'], 'a title word is no author');
  assert.deepEqual(labels('Battis/Krautzberger/Löhr, BauGB, § 35 Rn. 4'), ['literature: Battis/Krautzberger/Löhr, BauGB']);
  assert.deepEqual(labels('Jarass, BImSchG, 11. Aufl. 2015, § 5 Rn. 18'), ['literature: Jarass, BImSchG']);
  assert.deepEqual(labels('Gesetz vom 17. November 2014 (GVBl S. 478)'), ['legislation: GVBl. 2014 S. 478'], 'year from the date before');
  assert.deepEqual(labels('BGBl. I S. 2414'), [], 'no year, no identity');
  assert.deepEqual(labels('siehe www.umweltbundesamt.de/themen/windenergie.'), ['web: www.umweltbundesamt.de/themen/windenergie']);
  assert.equal(extractWorks('www.umweltbundesamt.de/x')[0].url, 'https://www.umweltbundesamt.de/x');
  assert.deepEqual(labels('Druck: www.heenemann-druck.de'), [], 'imprint');
  assert.ok(onTopic('Windenergieanlagen') && onTopic('die 10 H-Regelung') && !onTopic('Asylbewerber'));
});

test('a Saxon Vf. number is not a BayVerfGH decision', () => {
  const ids = (t: string) => extractRefs(t, null).map((r) => r.id);
  assert.deepEqual(ids('SächsVerfGH, Urteil vom 23. April 2008, Vf. 87-I-06'), []);
  assert.deepEqual(ids('BayVerfGH, Entscheidung vom 9. Mai 2016, Vf. 14-VII-14'), ['doc/bayverfgh-vf-14-vii-14']);
});
