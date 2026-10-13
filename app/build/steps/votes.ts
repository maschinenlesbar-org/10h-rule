// Step 7: individual votes from the roll-call lists in the protocols.
// - Bundestag (PlPr 18/44): names grouped by section (Ja/Nein/Enthalten) and Fraktion, four columns per page.
// - Bayerischer Landtag (PlPr 17/10, 17/29): "Abstimmungsliste" tables, name plus an X under Ja/Nein/Enthalte mich.
// Parsed totals must equal the protocol's totals (vote_event); otherwise the build fails.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { WIKI, DATA, log, type Ctx } from '../lib/ctx.ts';
import { bboxPages, columnOrder, segments, type Line, type Page } from '../lib/bbox.ts';
import { readCsv } from '../lib/text.ts';

type Option = 'yes' | 'no' | 'abstain' | 'not_voted';
interface ParsedVote { name: string; group: string | null; option: Option; page: number }

export interface ListSpec { file: string; parliament: 'bt' | 'by'; yes: number; no: number; anchor?: RegExp; pages: [number, number] }
export const LISTS: ListSpec[] = [
  // PDF pages 38–41 = protocol pp. 3958–3961: clause list pp. 3958–3960; 18/1903 list pp. 3961–3963 (PDF 41–43).
  { file: 'pdfs/BT-PlPr_18-44.pdf', parliament: 'bt', yes: 465, no: 114, pages: [38, 41] },
  { file: 'pdfs/BT-PlPr_18-44.pdf', parliament: 'bt', yes: 108, no: 467, pages: [41, 43] },
  { file: 'pdfs/BY-PlPr_17-10.pdf', parliament: 'by', yes: 96, no: 66, anchor: /Kreuzer, Karl Freller, Erwin Huber/, pages: [60, 91] },
  { file: 'pdfs/BY-PlPr_17-29_Auszug-Gesetzentwurf-2137.pdf', parliament: 'by', yes: 92, no: 63, anchor: /Schlussabstimmung am 12\.11\.2014/, pages: [20, 23] },
];

// ---------- Bundestag ----------

const BT_GROUPS: Array<[RegExp, string]> = [[/^CDU\/CSU$/, 'CDU/CSU'], [/^SPD$/, 'SPD'], [/^DIE LINKE\.?$/, 'DIE LINKE'],
  [/^BÜNDNIS 90\/\s*DIE GRÜNEN$/, 'BÜNDNIS 90/DIE GRÜNEN'], [/^DIE GRÜNEN$/, 'BÜNDNIS 90/DIE GRÜNEN'], [/^[Ff]raktionslos$/, 'fraktionslos']];
const SECTIONS: Record<string, Option> = { Ja: 'yes', Nein: 'no', Enthalten: 'abstain' };
const PARTICLE = /^(von|van|de|der|den|dem|zu|du|di|da|ten|vom)$/;
const NAME_TOKEN = /^(?:Dr\.|Prof\.|h\.|c\.|[A-ZÄÖÜ][\p{L}'’.-]*|\([^)]*\)?|[\p{L}]*\))$/u;

// Running page headers ("Vizepräsident Peter Hintze") look like names and are excluded explicitly.
function looksLikeName(s: string): boolean {
  if (s.length > 60 || /\d/.test(s) || /^(Vize)?[Pp]räsident(in)?\b|^Alterspräsident/.test(s)) return false;
  if (/[.!?:,]$/.test(s) && !/\b[A-ZÄÖÜ]\.$/.test(s)) return false; // sentence ends ("Vielen Dank."), but initials are fine
  const t = s.replace(/\s*\([^)]*\)?/g, '').split(/\s+/); // constituency suffixes like "(Weil am Rhein)" are not checked
  if (t.length < 2 || t.length > 7) return false;
  return t.every((w) => NAME_TOKEN.test(w) || PARTICLE.test(w)) && /[a-zäöüß]/.test(s);
}

const cleanLine = (s: string) => s.replace(/^\([A-D]\)\s*/, '').replace(/\s*\([A-D]\)$/, '').trim();

// Reads list pages in column order and returns the lines that follow the result block for this vote.
export function btLines(pages: Page[], spec: ListSpec): { lines: Array<{ text: string; page: number }>; found: boolean } {
  const out: Array<{ text: string; page: number }> = [];
  let state: 'seek' | 'block' | 'list' | 'done' = 'seek';
  let blockNums: number[] = [];
  for (const p of pages) {
    const all = segments(p);
    const lines = all.filter((l) => !/^[\d.,;:]+$/.test(l.text) && !/^\([A-D]\)$/.test(l.text));
    const cols = columnOrder(lines);
    // A new vote's heading splits the page into tiers: the end of the previous list above it, the new list below.
    // The tier starts at the first prose line above "Endgültiges Ergebnis" in its column.
    const bounds: number[] = [];
    for (const c of cols) {
      c.lines.forEach((l, k) => {
        if (!/Endgültiges Ergebnis/.test(l.text)) return;
        let top = l.y0;
        for (let j = k - 1; j >= 0 && !looksLikeName(cleanLine(c.lines[j].text)) && !SECTIONS[cleanLine(c.lines[j].text)]; j--) top = c.lines[j].y0;
        bounds.push(top - 1);
      });
    }
    const tierOf = (y: number) => bounds.filter((b) => y >= b).length;
    // Indented lines, lines starting with "(" or lowercase, and lines after a hyphen continue the name above.
    const ordered: Array<Line & { col: number }> = [];
    for (const [ci, c] of cols.entries()) {
      let prev: (Line & { col: number }) | null = null;
      for (const l of c.lines) {
        const continues = prev && l.y0 > prev.y0 && l.y0 - prev.y0 < 14 && tierOf(l.y0) === tierOf(prev.y0) &&
          (l.x0 - c.start > 4 || /^[(a-zäöü]/.test(l.text) || prev.text.endsWith('-'));
        if (continues && prev) prev.text = prev.text.endsWith('-') ? prev.text + l.text : `${prev.text} ${l.text}`;
        else { prev = { ...l, col: ci }; ordered.push(prev); }
      }
    }
    ordered.sort((a, b) => tierOf(a.y0) - tierOf(b.y0) || a.col - b.col || a.y0 - b.y0);
    for (const l of ordered) {
      const text = cleanLine(l.text);
      if (state === 'seek' && /Endgültiges Ergebnis/.test(text)) {
        // The totals are right-aligned and can fall into the next column; read them by position next to the block.
        blockNums = all.filter((n) => n.y0 >= l.y0 && n.y0 <= l.y0 + 75 && n.x0 >= l.x0 - 30 && n.x0 <= l.x0 + 160)
          .sort((a, b) => a.y0 - b.y0).flatMap((n) => [...n.text.matchAll(/\d+/g)].map((m) => Number(m[0])));
        state = 'block';
        continue;
      }
      if (state === 'block') {
        if (text === 'Ja') {
          // block numbers: cast, yes, no[, abstain]
          if (blockNums[1] === spec.yes && blockNums[2] === spec.no) { state = 'list'; out.push({ text, page: p.no }); }
          else state = 'seek';
        }
        continue;
      }
      if (state === 'list') {
        if (/Endgültiges Ergebnis/.test(text)) { state = 'done'; break; }
        out.push({ text, page: p.no });
      }
    }
    if (state === 'done') break;
  }
  return { lines: out, found: out.length > 0 };
}

export function parseBt(lines: Array<{ text: string; page: number }>): ParsedVote[] {
  const votes: ParsedVote[] = [];
  let option: Option | null = null, group: string | null = null, pendingGroup = '';
  for (const { text, page } of lines) {
    if (SECTIONS[text]) { option = SECTIONS[text]; group = null; continue; }
    const g = BT_GROUPS.find(([re]) => re.test(pendingGroup ? `${pendingGroup} ${text}` : text));
    if (g) { group = g[1]; pendingGroup = ''; continue; }
    if (/^BÜNDNIS 90\/$/.test(text)) { pendingGroup = text; continue; }
    if (!option || !looksLikeName(text)) continue;
    votes.push({ name: text, group, option, page });
  }
  return votes;
}

// ---------- Bayerischer Landtag ----------

export function parseBy(pages: Page[], spec: ListSpec): ParsedVote[] {
  const votes: ParsedVote[] = [];
  let inList = false;
  for (const p of pages) {
    const text = p.lines.map((l) => l.text).join(' ');
    if (/Abstimmungsliste/.test(text)) inList = spec.anchor!.test(text.replace(/\s+/g, ' '));
    if (!inList) continue;
    // Column headers: each half has "Ja" and "Nein" (and "Enthalte"/"mich") near the top.
    const head = p.lines.flatMap((l) => l.words).filter((w) => /^(Ja|Nein|Enthalte)$/.test(w.text));
    const cols = (label: string) => head.filter((w) => w.text === label).map((w) => (w.x0 + w.x1) / 2).sort((a, b) => a - b);
    const ja = cols('Ja'), nein = cols('Nein'), enth = cols('Enthalte');
    const nameStarts = p.lines.flatMap((l) => l.words).filter((w) => w.text === 'Name').map((w) => w.x0).sort((a, b) => a - b);
    if (ja.length < 1 || nameStarts.length < 1) continue;
    const headerY = Math.max(...head.map((w) => w.y1));
    const halves = nameStarts.map((x0, i) => ({ x0, ja: ja[i], nein: nein[i], enth: enth[i] }));
    // Group words into rows by y, then into halves by x.
    const words = p.lines.flatMap((l) => l.words).filter((w) => w.y0 > headerY + 2);
    const rows = new Map<number, typeof words>();
    for (const w of words) {
      const key = [...rows.keys()].find((y) => Math.abs(y - w.y0) < 3) ?? w.y0;
      rows.set(key, [...(rows.get(key) ?? []), w]);
    }
    for (const row of [...rows.entries()].sort((a, b) => a[0] - b[0]).map((r) => r[1])) {
      halves.forEach((hf, i) => {
        const right = halves[i + 1]?.x0 ?? Infinity;
        const ws = row.filter((w) => w.x0 >= hf.x0 - 2 && w.x0 < right - 2).sort((a, b) => a.x0 - b.x0);
        const nameWords = ws.filter((w) => w.x1 < hf.ja - 12);
        const marks = ws.filter((w) => /^[Xx]$/.test(w.text) && w.x0 >= hf.ja - 15);
        const name = nameWords.map((w) => w.text).join(' ').trim();
        if (!name || /^(Name|mich|Ja|Nein|Enthalte|Gesamtsumme)$/.test(name) || !/[a-zäöü]/.test(name) || /Landtag|Anlage|Vollsitzung|Abstimmung/.test(name)) return;
        let option: Option = 'not_voted';
        if (marks.length) {
          const x = (marks[0].x0 + marks[0].x1) / 2;
          const d = [['yes', hf.ja], ['no', hf.nein], ['abstain', hf.enth ?? Infinity]] as Array<[Option, number]>;
          option = d.sort((a, b) => Math.abs(a[1] - x) - Math.abs(b[1] - x))[0][0];
        }
        votes.push({ name, group: null, option, page: p.no });
      });
    }
  }
  return votes;
}

// ---------- matching names ----------

// Name as a sorted set of tokens: no titles, constituency suffixes, initials, particles or diacritics, so that
// "Prof. (Univ. Lima) Dr. Bauer Peter" = "Peter Bauer" and "Freiherr von Lerchenfeld Ludwig" = "Ludwig von und zu Lerchenfeld".
const tokenList = (s: string) => s.replace(/\([^)]*\)/g, ' ').normalize('NFKD').replace(/[\u0300-\u036f\u00ad]/g, '').toLowerCase()
  .split(/[\s-]+/).map((t) => t.replace(/\.$/, '')).filter((t) => t.length > 1 && !/^(dr|prof|univ|freiherr|freifrau|graf|von|und|zu|van|de|der)$/.test(t));
const tokens = (s: string) => tokenList(s).sort().join(' ');

function personIndex(db: DatabaseSync): Map<string, string> {
  const idx = new Map<string, string>();
  for (const r of db.prepare("SELECT entity_id, alias FROM alias a JOIN entity e ON e.id = a.entity_id WHERE e.type = 'Person' AND a.kind = 'label'").all() as Array<{ entity_id: string; alias: string }>) {
    idx.set(tokens(r.alias), r.entity_id);
  }
  return idx;
}

// Fraktion of Bavarian members on a date: wiki party first, then the Fraktion printed in a source document
// (data/fraktion-documented.csv), then abgeordnetenwatch if valid on that date.
function byFraktion(db: DatabaseSync, date: string, report: Ctx['report']): (name: string, personId: string | null) => { group: string | null; source: string } {
  const file = join(DATA, 'members-by-17.csv');
  const members = existsSync(file) ? readCsv(file) : [];
  const docFile = join(DATA, 'fraktion-documented.csv');
  const pageText = db.prepare('SELECT p.text FROM page p JOIN file f ON f.id = p.file_id WHERE f.doc_id = ? AND p.page_no = ?');
  const docLabel = db.prepare('SELECT label FROM entity WHERE id = ?');
  const flat = (t: string) => t.replace(/\s+/g, ' ');
  const documented = (existsSync(docFile) ? readCsv(docFile) : []).filter((r) => {
    const page = pageText.get(r.doc_id, Number(r.page)) as { text: string } | undefined;
    if (page && flat(page.text).includes(flat(r.quote))) return true;
    report.add('FAIL: documented Fraktion whose quote is not on the page', `${r.name}: ${r.doc_id} p. ${r.page}`);
    return false;
  });
  const short: Record<string, string> = { 'DIE GRÜNEN': 'GRÜNE', 'FREIE WÄHLER': 'FREIE WÄHLER' };
  const wikiParty = db.prepare(`SELECT o.label FROM statement s JOIN entity o ON o.id = s.obj WHERE s.subj = ? AND s.pred = 'member_of'
                                AND json_extract(o.props, '$.classification') = 'party' LIMIT 1`);
  return (name, personId) => {
    if (personId) {
      const w = wikiParty.get(personId) as { label: string } | undefined;
      if (w) return { group: w.label.replace('BÜNDNIS 90/DIE GRÜNEN', 'GRÜNE'), source: 'wiki' };
    }
    const d = documented.find((r) => tokens(r.name) === tokens(name) && r.valid_from <= date && r.valid_until >= date);
    if (d) return { group: d.fraction, source: `${(docLabel.get(d.doc_id) as { label: string } | undefined)?.label ?? d.doc_id}, p. ${d.page}` };
    let m = members.filter((r) => tokens(r.name) === tokens(name));
    let how = 'abgeordnetenwatch';
    if (!m.length) {
      // Fallback for name changes (Schreyer-Stäblein → Schreyer, Markus → Tessa Ganserer): a surname that is unique among members.
      const t = tokenList(name);
      const bySurname = members.filter((r) => { const last = tokenList(r.name).at(-1)!; return t.includes(last); });
      const ids = new Set(bySurname.map((r) => r.abgeordnetenwatch_id));
      if (ids.size === 1) { m = bySurname; how = 'abgeordnetenwatch (matched by surname)'; }
    }
    const valid = m.filter((r) => (!r.valid_from || r.valid_from <= date) && (!r.valid_until || r.valid_until >= date));
    if (valid.length === 1) return { group: short[valid[0].fraction] ?? valid[0].fraction, source: how };
    return { group: null, source: m.length ? 'abgeordnetenwatch (not valid on the date)' : 'not found' };
  };
}

export function votes(ctx: Ctx): void {
  const { db, report } = ctx;
  const ins = db.prepare('INSERT INTO vote (vote_event_id, name, person_id, group_label, group_source, option, file_id, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const people = personIndex(db);
  let total = 0;
  for (const spec of LISTS) {
    const ev = db.prepare('SELECT id, date FROM vote_event WHERE yes = ? AND no = ?').get(spec.yes, spec.no) as { id: string; date: string } | undefined;
    if (!ev) { report.add('FAIL: roll-call lists without a vote event', `${spec.file} ${spec.yes}:${spec.no}`); continue; }
    const pages = bboxPages(join(WIKI, spec.file), spec.pages[0], spec.pages[1]);
    const parsed = spec.parliament === 'bt' ? parseBt(btLines(pages, spec).lines) : parseBy(pages, spec);
    const fraktion = spec.parliament === 'by' ? byFraktion(db, ev.date, report) : null;
    const counts: Record<string, number> = { yes: 0, no: 0, abstain: 0, not_voted: 0 };
    for (const v of parsed) {
      const personId = people.get(tokens(v.name)) ?? null;
      const g = fraktion ? fraktion(v.name, personId) : { group: v.group, source: 'protocol' };
      if (fraktion && !g.group) report.add('Roll-call members without a Fraktion on the vote date', `${v.name} (${ev.id}): ${g.source}`);
      ins.run(ev.id, v.name, personId, g.group, g.source, v.option, spec.file, v.page);
      counts[v.option]++;
      total++;
    }
    const expected = db.prepare('SELECT yes, no, abstain FROM vote_event WHERE id = ?').get(ev.id) as { yes: number; no: number; abstain: number };
    const ok = counts.yes === expected.yes && counts.no === expected.no && counts.abstain === expected.abstain;
    const line = `${ev.id}: parsed ${counts.yes} : ${counts.no} : ${counts.abstain} (not voted ${counts.not_voted}), protocol ${expected.yes} : ${expected.no} : ${expected.abstain}`;
    report.add(ok ? 'Roll-call lists parsed' : 'FAIL: roll-call list totals differ from the protocol', line);
    if (!ok) ctx.failures = (ctx.failures ?? 0) + 1;
  }
  const matched = db.prepare('SELECT count(*) n FROM vote WHERE person_id IS NOT NULL').get() as { n: number };
  report.count('Individual votes', total);
  report.count('Individual votes matched to a person entity', matched.n);
  log(`votes: ${total} individual votes, ${matched.n} matched to people`);
}
