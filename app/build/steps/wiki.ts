// Step 4: wiki pages → people, events, questions, speeches, roll calls and document metadata.
// The wiki is the source of truth for these facts (CONCEPT.md, section 5). Every statement records the page and
// table line it was read from; markers come from the row text.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { WIKI, log, type Ctx } from '../lib/ctx.ts';
import { mdTables, plain, mdLinks, markerOf, parseDate, type MdTable, type Marker } from '../lib/text.ts';
import { slug, personId } from '../lib/ids.ts';
import { extractRefs, type Parliament } from '../lib/refs.ts';
import { upsertEntity, addAlias, addStatement, addEvidence } from '../lib/db.ts';
import { Dict } from '../lib/dict.ts';
import { kindOf, numberOf } from './inventory.ts';

// Parliament context for bare Drucksache numbers on each page.
const PAGE_CTX: Record<string, Parliament> = {
  'anfragen-bayern.md': 'by', 'bayern-10h.md': 'by', 'origin-bayern-2013.md': 'by',
  'sachsen.md': 'sn', 'anfragen-bundestag.md': 'bt', 'bund-2014.md': 'bt', 'bundesrat-2013.md': 'br',
};

// Surnames that are also common German words or shared by several people: never used alone.
const SURNAME_STOP = new Set(['Stein', 'Fuchs', 'Wild', 'Huber', 'Müller', 'Kamm', 'Herz', 'Scharf', 'Lay', 'Roos', 'Karl', 'Schulze', 'Werner']);

interface Say { subj: string; pred: string; obj?: string | null; value?: string | null; start?: string | null; precision?: string | null;
  marker: Marker; method?: string; source: string; evidence?: { doc?: string | null; page?: number | null; locator?: string | null; quote?: string | null } }

class Writer {
  private seen = new Map<string, string>();
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }
  say(s: Say): string {
    const key = [s.subj, s.pred, s.obj ?? '', s.value ?? ''].join('|');
    let id = this.seen.get(key);
    if (!id) {
      id = addStatement(this.db, { ...s, method: s.method ?? 'wiki' });
      this.seen.set(key, id);
    }
    if (s.evidence) addEvidence(this.db, id, { ...s.evidence, readVia: 'wiki' });
    return id;
  }
}

export function ensureDoc(db: DatabaseSync, id: string, url?: string): void {
  if (!id.startsWith('doc/')) return;
  const exists = db.prepare('SELECT 1 FROM document WHERE id = ?').get(id);
  if (exists) {
    if (url) db.prepare('UPDATE document SET source_url = coalesce(source_url, ?) WHERE id = ?').run(url, id);
    return;
  }
  const parl = id.match(/^doc\/(bt|br|by|sn|mv|ni|sh)-/)?.[1] ?? null;
  const { number, wp } = numberOf(id);
  const vf = id.match(/^doc\/bayverfgh-vf-(\d+)-([ivx]+)-(\d{2})$/), wd = id.match(/^doc\/wd-(\d+)-(\d{3})-(\d{2})$/);
  const label = number ? `${parl ? parl.toUpperCase() + ' ' : ''}${kindOf(id).replace('Drucksache', 'Drs')} ${number}`
    : vf ? `BayVerfGH Vf. ${vf[1]}-${vf[2].toUpperCase()}-${vf[3]}` : wd ? `WD ${wd[1]}-${wd[2]}/${wd[3]}` : id.replace(/^doc\//, '');
  upsertEntity(db, id, 'Document', label, {});
  db.prepare('INSERT INTO document (id, kind, parliament, number, wp, source_url, archived) VALUES (?, ?, ?, ?, ?, ?, 0)')
    .run(id, kindOf(id), parl, number, wp, url ?? null);
}

// Document ids in a table cell: explicit references, link texts, and bare "17/554" numbers (with page context).
// A bare number right after a protocol word ("PlPr 18/33", "Wortprotokoll 18/15", "APr 6/5-3") or a page reference
// is not a Drucksache.
const NOT_DRS_BEFORE = /(PlPr\.?|Plenarprotokoll|Wortprotokoll|APr|Umdruck|GVBl|BGBl|AUL|pp?\.|S\.)\s*$/;
function docsIn(db: DatabaseSync, cell: string, ctx: Parliament, _drsColumn = false): string[] {
  const ids = new Set<string>();
  const links = mdLinks(cell);
  for (const r of extractRefs(plain(cell), ctx)) if (r.id && r.kind === 'doc') ids.add(r.id);
  if (ctx && ctx !== 'br') {
    const text = plain(cell);
    for (const m of text.matchAll(/(?<![\d/§.])(\d{1,2})\/(\d{1,5})(?![\d/-])/g)) {
      if (NOT_DRS_BEFORE.test(text.slice(Math.max(0, m.index! - 16), m.index))) continue;
      const [lo, hi] = { bt: [16, 20], by: [15, 18], sn: [4, 7] }[ctx as 'bt' | 'by' | 'sn'] ?? [0, 0];
      if (Number(m[1]) >= lo && Number(m[1]) <= hi) ids.add(`doc/${ctx}-drs-${Number(m[1])}-${Number(m[2])}`);
    }
  }
  for (const id of ids) {
    const link = links.find((l) => extractRefs(l.text, ctx).some((r) => r.id === id) || l.text.includes(id.split('-').slice(-2).join('/')));
    ensureDoc(db, id, link && /^https?:/.test(link.url) ? link.url : undefined);
  }
  return [...ids];
}

const col = (t: MdTable, ...names: string[]) => t.headers.findIndex((h) => names.some((n) => h.toLowerCase().startsWith(n.toLowerCase())));

function readPeople(ctx: Ctx, w: Writer, partyDict: Dict): void {
  const { db, report } = ctx;
  const files = readdirSync(join(WIKI, 'people')).filter((f) => f.endsWith('.md'));
  const surnames = new Map<string, string[]>();
  for (const f of files) {
    const src = readFileSync(join(WIKI, 'people', f), 'utf8');
    const name = src.match(/^# (.+)$/m)?.[1].trim();
    if (!name) { report.add('Profiles without a name', f); continue; }
    const id = personId(basename(f, '.md'));
    upsertEntity(db, id, 'Person', name, { profile: `people/${f}` });
    addAlias(db, id, name, 'label');
    const last = name.split(' ').at(-1)!;
    surnames.set(last, [...(surnames.get(last) ?? []), id]);
    const facts = mdTables(src)[0];
    if (!facts) continue;
    for (const [k, v] of facts.rows) {
      const source = `people/${f}`;
      if (k === 'Party (wiki)') {
        for (const h of partyDict.match(plain(v)).hits) w.say({ subj: id, pred: 'member_of', obj: h.entityId, marker: markerOf(v), source });
      }
      if (k === 'IDs') {
        const aw = v.match(/abgeordnetenwatch \[(\d+)\]/)?.[1];
        const dip = v.match(/DIP person (\d+)/)?.[1];
        if (aw) db.prepare('INSERT OR IGNORE INTO external_id VALUES (?, ?, ?, ?, ?)').run(id, 'abgeordnetenwatch', aw, 'confirmed', 'wiki');
        if (dip) db.prepare('INSERT OR IGNORE INTO external_id VALUES (?, ?, ?, ?, ?)').run(id, 'dip_person', dip, 'confirmed', 'wiki');
      }
    }
  }
  for (const [last, ids] of surnames) {
    if (ids.length === 1 && last.length >= 4 && !SURNAME_STOP.has(last)) addAlias(db, ids[0], last, 'surname');
  }
  report.count('People (profiles)', files.length);
}

// "Dr. Paul Wengert (SPD)" for askers without a profile: create the person only when a party follows the name.
function personsWithParty(ctx: Ctx, w: Writer, cell: string, partyDict: Dict, source: string, spans: Array<[number, number]> = []): string[] {
  const out: string[] = [];
  for (const m of plain(cell).matchAll(/(?:Dr\. |Prof\. )*((?:[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)? ){1,2}[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?) \(([^)]+)\)/g)) {
    const party = partyDict.match(m[2]).hits[0];
    if (!party) continue;
    const name = m[1].trim();
    const existing = ctx.db.prepare("SELECT entity_id FROM alias a JOIN entity e ON e.id = a.entity_id WHERE e.type = 'Person' AND alias = ?").get(name) as { entity_id: string } | undefined;
    const id = existing?.entity_id ?? `person/${slug(name)}`;
    if (!existing) {
      upsertEntity(ctx.db, id, 'Person', name, { profile: null });
      addAlias(ctx.db, id, name, 'label');
      ctx.report.add('People without a profile (created from the wiki)', `${name} (${m[2]}), ${source}`);
    }
    w.say({ subj: id, pred: 'member_of', obj: party.entityId, marker: 'primary', source });
    out.push(id);
    spans.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

function readEvents(ctx: Ctx, w: Writer, actorDict: Dict): void {
  const { db, report } = ctx;
  const pages = ['timeline.md', 'sachsen.md', 'bayern-10h.md', 'bund-2014.md'];
  const byDate = new Map<string, Array<{ id: string; docs: Set<string> }>>();
  let n = 0;
  for (const page of pages) {
    const pctx = PAGE_CTX[page] ?? null;
    for (const t of mdTables(readFileSync(join(WIKI, page), 'utf8'))) {
      if (t.headers[0] !== 'Date') continue;
      const iText = col(t, 'Event', 'Step');
      const iDoc = col(t, 'Source', 'Document');
      const iBody = col(t, 'Body');
      if (iText < 0) continue;
      t.rows.forEach((r, k) => {
        const source = `${page}:${t.line + 2 + k}`;
        const date = parseDate(r[0]);
        if (!date) { report.add('Event dates that could not be parsed', `${source}: ${plain(r[0])}`); return; }
        const text = plain(r[iText]);
        const marker = markerOf(r.join(' '));
        const docs = new Set([...docsIn(db, r[iDoc] ?? '', pctx), ...docsIn(db, r[iText], pctx)]);
        // Same date and a shared source document: the same event told on two pages.
        const same = (byDate.get(date.iso) ?? []).find((e) => [...docs].some((d) => e.docs.has(d)));
        let id = same?.id;
        if (!id) {
          id = `event/${date.iso}-${slug(text.split(' ').slice(0, 5).join(' '))}`;
          const body = iBody >= 0 ? plain(r[iBody]) : null;
          const arena = arenaOf(docs, body, text, pctx);
          upsertEntity(db, id, 'Event', text.length > 140 ? text.slice(0, text.lastIndexOf(' ', 137)) + ' …' : text,
            { date: date.iso, end: date.end ?? null, precision: date.precision, text, arena, body, pages: [page] });
          byDate.set(date.iso, [...(byDate.get(date.iso) ?? []), { id, docs }]);
          n++;
        } else {
          const props = JSON.parse((db.prepare('SELECT props FROM entity WHERE id = ?').get(id) as { props: string }).props);
          if (!props.pages.includes(page)) upsertEntity(db, id, 'Event', '', { pages: [...props.pages, page], [`text_${slug(page)}`]: text });
          docs.forEach((d) => same!.docs.add(d));
        }
        for (const d of docs) w.say({ subj: id, pred: 'documented_in', obj: d, start: date.iso, precision: date.precision, marker, source, evidence: { doc: d } });
        for (const h of actorDict.match(text).hits) w.say({ subj: id, pred: 'involves', obj: h.entityId, start: date.iso, marker, method: 'dictionary', source });
      });
    }
  }
  report.count('Events', n);
}

function arenaOf(docs: Set<string>, body: string | null, text: string, pctx: Parliament): string {
  if (body) return { BReg: 'bund-government', BR: 'br', BT: 'bt', BGBl: 'bund-government' }[body] ?? 'bund-government';
  if (/^Sachsen|Saxon/.test(text) || pctx === 'sn') return 'sn';
  if (/Bundesrat/.test(text)) return 'br';
  if (/federal cabinet|[Cc]oalition agreement|Bundesregierung|federal government|BGBl|§ 249 Abs\. 3 BauGB enters|[Dd]eadline of the federal clause/.test(text)) return 'bund-government';
  if (/Bayer|Bavaria|Seehofer|BayBO|BayVerfGH|constitutional court/.test(text) || pctx === 'by') return 'by';
  if (/Bundestag/.test(text)) return 'bt';
  const parls = [...docs].map((d) => d.match(/^doc\/(bt|br|by|sn|mv|ni|sh)-/)?.[1]).filter(Boolean);
  return parls[0] ?? 'bund-government';
}

// People named in a cell: "Name (Party)" first, then the dictionary on the rest of the cell, so a first name inside a
// resolved name cannot also link someone by surname ("Bernhard Roos (SPD)" is not Otmar Bernhard).
function peopleIn(ctx: Ctx, w: Writer, cell: string, personDict: Dict, partyDict: Dict, source: string): string[] {
  const spans: Array<[number, number]> = [];
  const named = personsWithParty(ctx, w, cell, partyDict, source, spans);
  let rest = plain(cell);
  for (const [a, b] of spans) rest = rest.slice(0, a) + ' '.repeat(b - a) + rest.slice(b);
  return [...new Set([...named, ...personDict.match(rest).hits.map((h) => h.entityId)])];
}

function readQuestions(ctx: Ctx, w: Writer, personDict: Dict, orgDict: Dict, partyDict: Dict): void {
  const { db, report } = ctx;
  const askers = (cell: string, source: string) => {
    const ids = new Set(peopleIn(ctx, w, cell, personDict, partyDict, source));
    if (!ids.size && !/^(GRÜNE|DIE LINKE|SPD|CSU|FW)\b/.test(plain(cell))) report.add('Askers not matched to a person', `${source}: ${plain(cell)}`);
    return [...ids];
  };
  // anfragen/README.md: one row per file
  const readme = 'anfragen/README.md';
  for (const t of mdTables(readFileSync(join(WIKI, readme), 'utf8'))) {
    const iFile = col(t, 'File'), iAsker = col(t, 'Asker'), iType = col(t, 'Type');
    if (iFile < 0 || iAsker < 0) continue;
    t.rows.forEach((r, k) => {
      const source = `${readme}:${t.line + 2 + k}`;
      const file = mdLinks(r[iFile])[0]?.text;
      const doc = (db.prepare('SELECT doc_id FROM file WHERE id LIKE ?').get(`%/${file}`) as { doc_id: string } | undefined)?.doc_id;
      if (!doc) { report.add('Archive rows without a file', source); return; }
      if (/answer|Antwort|supplement/i.test(plain(r[iType] ?? '')) && !/question|Frage|Anfrage\b/i.test(plain(r[iType] ?? ''))) return;
      for (const p of askers(r[iAsker], source)) w.say({ subj: p, pred: 'asked', obj: doc, marker: markerOf(r.join(' ')), source, evidence: { doc, page: 1 } });
    });
  }
  // Topic pages with question tables
  for (const page of ['anfragen-bundestag.md', 'anfragen-bayern.md', 'sachsen.md']) {
    const pctx = PAGE_CTX[page];
    for (const t of mdTables(readFileSync(join(WIKI, page), 'utf8'))) {
      const iDrs = col(t, 'Drs'), iAsker = col(t, 'Asker');
      if (iDrs < 0 || iAsker < 0) continue;
      const iBy = col(t, 'Answered by'), iFiled = col(t, 'Filed'), iAnswered = t.headers.findIndex((h) => h === 'Answered');
      const iDate = col(t, 'Date'), iType = col(t, 'Type');
      t.rows.forEach((r, k) => {
        const source = `${page}:${t.line + 2 + k}`;
        const docs = docsIn(ctx.db, r[iDrs], pctx, true);
        if (!docs.length) { report.add('Question rows without a Drucksache', source); return; }
        const marker = markerOf(r.join(' '));
        const question = docs[0], answerDoc = docs.at(-1)!;
        if (docs.length > 1) w.say({ subj: answerDoc, pred: 'responds_to', obj: question, marker, source });
        const filed = iFiled >= 0 ? parseDate(plain(r[iFiled]).split('→')[0].trim()) : iDate >= 0 ? parseDate(plain(r[iDate])) : null;
        const answeredText = iFiled >= 0 ? plain(r[iFiled]).split('→')[1] ?? '' : iAnswered >= 0 ? plain(r[iAnswered]) : '';
        const answered = parseDate(answeredText.trim().split(' ')[0] ?? '');
        const type = iType >= 0 ? plain(r[iType]) : null;
        for (const p of askers(r[iAsker], source)) {
          w.say({ subj: p, pred: 'asked', obj: question, value: type, start: filed?.iso, precision: filed?.precision, marker, source, evidence: { doc: question } });
        }
        // Answerer: "PStS Katherina Reiche, BMU" or "(SMI, signed by Markus Ulbig)"
        const answerCell = iBy >= 0 ? plain(r[iBy]) : answeredText;
        const answerers = new Set(personDict.match(answerCell).hits.map((h) => h.entityId));
        const signer = answerCell.match(/signed by (?:Dr\. )?((?:[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)? ?){2,3})/)?.[1].trim();
        if (signer && !answerers.size) {
          const id = `person/${slug(signer)}`;
          upsertEntity(db, id, 'Person', signer, { profile: null });
          addAlias(db, id, signer, 'label');
          report.add('People without a profile (created from the wiki)', `${signer} (answer signed), ${source}`);
          answerers.add(id);
        }
        for (const p of answerers) {
          w.say({ subj: p, pred: 'answered', obj: answerDoc, value: type, start: answered?.iso ?? null, precision: answered?.precision, marker, source, evidence: { doc: answerDoc } });
        }
        for (const h of orgDict.match(answerCell).hits.filter((x) => x.type === 'Organization')) {
          const cls = JSON.parse((db.prepare('SELECT props FROM entity WHERE id = ?').get(h.entityId) as { props: string }).props).classification;
          if (cls === 'ministry' || cls === 'government') w.say({ subj: answerDoc, pred: 'answered_for', obj: h.entityId, marker, source });
        }
      });
    }
  }
}

function readDebate(ctx: Ctx, w: Writer, personDict: Dict, partyDict: Dict): void {
  const page = 'bund-2014.md';
  const src = readFileSync(join(WIKI, page), 'utf8');
  const plpr = 'doc/bt-plpr-18-44';
  ensureDoc(ctx.db, plpr);
  for (const t of mdTables(src)) {
    const iSpeaker = col(t, 'Speaker'), iMember = col(t, 'Member'), iPage = col(t, 'Page');
    const iName = iSpeaker >= 0 ? iSpeaker : iMember;
    if (iName < 0 || iPage < 0) continue;
    t.rows.forEach((r, k) => {
      const source = `${page}:${t.line + 2 + k}`;
      const people = peopleIn(ctx, w, r[iName], personDict, partyDict, source);
      if (!people.length) {
        const name = plain(r[iName]).replace(/^(Dr\.|Prof\.)\s+/g, '').replace(/\s*\(.*\)$/, '');
        if (/^[A-ZÄÖÜ]/.test(name) && name.split(' ').length <= 3) {
          const id = `person/${slug(name)}`;
          upsertEntity(ctx.db, id, 'Person', name, { profile: null });
          addAlias(ctx.db, id, name, 'label');
          ctx.report.add('People without a profile (created from the wiki)', `${name}, ${source}`);
          people.push(id);
        }
      }
      const pg = Number(plain(r[iPage]).match(/\d+/)?.[0]);
      const pred = iSpeaker >= 0 ? 'spoke_in' : 'authored';
      const role = plain(r[col(t, 'Fraktion')] ?? '');
      const kind = /Zwischenfrage/.test(role) ? 'Zwischenfrage' : /§ 30/.test(role) ? 'Erklärung nach § 30 GO-BT' : 'Rede';
      const clause = /^yes/i.test(plain(r[col(t, 'Addresses')] ?? '')) ? ', spricht die Länderöffnungsklausel an' : '';
      const value = iSpeaker >= 0 ? `${kind}, S. ${plain(r[iPage])}${clause}` : `Erklärung nach § 31 GO-BT, Anlage ${plain(r[0])}, S. ${plain(r[iPage])}`;
      for (const p of people) w.say({ subj: p, pred, obj: plpr, value, start: '2014-06-27', precision: 'day', marker: markerOf(r.join(' ')), source,
        evidence: { doc: plpr, page: pg || null, locator: `S. ${plain(r[iPage])}` } });
    });
  }
}

function readVotes(ctx: Ctx, w: Writer): void {
  const { db, report } = ctx;
  const ins = db.prepare('INSERT OR IGNORE INTO vote_event (id, date, body, motion, yes, no, abstain, source_doc, locator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const seen = new Set<string>();
  const add = (date: string, body: string, motion: string, yes: number, no: number, abst: number, doc: string | null, locator: string | null, source: string) => {
    const key = `${date}|${yes}|${no}`;
    if (seen.has(key)) return;
    seen.add(key);
    const id = `vote/${date}-${slug(body)}-${yes}-${no}`;
    upsertEntity(db, id, 'VoteEvent', `${body}, ${date.split('-').reverse().join('.')}: ${motion}`, { date, yes, no, abstain: abst });
    ins.run(id, date, body, motion, yes, no, abst, doc, locator);
    if (doc) w.say({ subj: id, pred: 'documented_in', obj: doc, start: date, precision: 'day', marker: 'primary', source, evidence: { doc, locator } });
    report.count('Roll-call votes (totals)');
  };
  for (const t of mdTables(readFileSync(join(WIKI, 'README.md'), 'utf8'))) {
    if (t.headers[0] !== 'Vote' || col(t, 'Yes') < 0) continue;
    t.rows.forEach((r, k) => {
      const source = `README.md:${t.line + 2 + k}`;
      const [body, dateS, ...rest] = plain(r[0]).split(', ');
      const date = parseDate(dateS);
      const docs = docsIn(db, r[col(t, 'Source')] ?? '', body.startsWith('Bayer') ? 'by' : 'bt');
      if (!date) { report.add('Vote rows without a date', source); return; }
      add(date.iso, body, rest.join(', '), Number(plain(r[col(t, 'Yes')])), Number(plain(r[col(t, 'No')])), Number(plain(r[col(t, 'Abstained')])),
        docs[0] ?? null, plain(r[col(t, 'Source')]).match(/p\. [\d–\- ,A-Z]+/)?.[0] ?? null, source);
    });
  }
  for (const t of mdTables(readFileSync(join(WIKI, 'bund-2014.md'), 'utf8'))) {
    if (t.headers[0] !== 'Vote' || col(t, 'Cast') < 0) continue;
    t.rows.forEach((r, k) => {
      const motion = plain(r[0]);
      add('2014-06-27', 'Bundestag', motion.replace(/, 27\.06\.2014$/, ''), Number(plain(r[col(t, 'Yes')])), Number(plain(r[col(t, 'No')])),
        Number(plain(r[col(t, 'Abstained')])), 'doc/bt-plpr-18-44', null, `bund-2014.md:${t.line + 2 + k}`);
    });
  }
}

function readDocumentTables(ctx: Ctx, w: Writer, orgDict: Dict): void {
  const { db } = ctx;
  // Research-service papers: reference, date, title
  for (const t of mdTables(readFileSync(join(WIKI, 'research-services.md'), 'utf8'))) {
    if (t.headers[0] !== 'Reference') continue;
    for (const r of t.rows) {
      const ref = extractRefs(plain(r[0]), 'bt').find((x) => x.id)?.id;
      if (!ref) continue;
      ensureDoc(db, ref, mdLinks(r[col(t, 'Title')])[0]?.url);
      const date = parseDate(plain(r[col(t, 'Date')]));
      db.prepare('UPDATE document SET title = coalesce(title, ?), date = coalesce(date, ?) WHERE id = ?')
        .run(plain(r[col(t, 'Title')]), date?.iso ?? null, ref);
    }
  }
  // Bavarian Anträge: Drs, date, from, content
  for (const t of mdTables(readFileSync(join(WIKI, 'bayern-10h.md'), 'utf8'))) {
    if (t.headers[0] !== 'Drs' || col(t, 'From') < 0) continue;
    t.rows.forEach((r, k) => {
      const docs = docsIn(db, r[0], 'by', true);
      const date = parseDate(plain(r[col(t, 'Date')]));
      for (const d of docs.slice(0, 1)) {
        db.prepare('UPDATE document SET title = coalesce(title, ?), date = coalesce(date, ?), kind = ? WHERE id = ?')
          .run(plain(r[col(t, 'Content')]), date?.iso ?? null, 'Antrag', d);
        for (const h of orgDict.match(plain(r[col(t, 'From')])).hits) {
          w.say({ subj: h.entityId, pred: 'authored', obj: d, start: date?.iso, precision: date?.precision, marker: markerOf(r.join(' ')), source: `bayern-10h.md:${t.line + 2 + k}` });
        }
      }
    });
  }
}

// Every resolvable reference anywhere in the wiki becomes a document entity (with its URL if linked).
function readAllReferences(ctx: Ctx): void {
  const pages = [...readdirSync(WIKI).filter((f) => f.endsWith('.md')), ...readdirSync(join(WIKI, 'people')).map((f) => `people/${f}`)];
  for (const page of pages) {
    const src = readFileSync(join(WIKI, page), 'utf8');
    const pctx = PAGE_CTX[page] ?? null;
    for (const l of mdLinks(src)) for (const r of extractRefs(l.text, pctx)) if (r.id?.startsWith('doc/')) ensureDoc(ctx.db, r.id, /^https?:/.test(l.url) ? l.url : undefined);
    for (const r of extractRefs(plain(src), pctx)) if (r.id?.startsWith('doc/')) ensureDoc(ctx.db, r.id);
  }
}

export function wiki(ctx: Ctx): void {
  const w = new Writer(ctx.db);
  const partyDict = new Dict(ctx.db, { types: ['Organization'] });
  readPeople(ctx, w, partyDict);
  const personDict = new Dict(ctx.db, { types: ['Person'] });
  const orgDict = new Dict(ctx.db, { types: ['Organization'] });
  readQuestions(ctx, w, personDict, orgDict, partyDict);
  readDebate(ctx, w, personDict, partyDict);
  const actorDict = new Dict(ctx.db, { types: ['Person', 'Organization'] });
  readEvents(ctx, w, actorDict);
  readVotes(ctx, w);
  readDocumentTables(ctx, w, orgDict);
  readAllReferences(ctx);
  const n = ctx.db.prepare("SELECT count(*) n FROM statement WHERE method IN ('wiki','dictionary')").get() as { n: number };
  ctx.report.count('Statements from the wiki', n.n);
  log(`wiki: ${n.n} statements`);
}
