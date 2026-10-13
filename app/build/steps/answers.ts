// Step 4b: the answering ministry of each Bavarian Schriftliche Anfrage, read from the answer heading
// ("Antwort … des Staatsministeriums für … vom 22.07.2013"). In the two-column layout the heading and the ministry
// can be separated, so the first "des Staatsministeriums … vom <date>" after "Antwort" is taken. Checked by hand on
// four answers (16/18270, 17/2835, 17/9570, 17/12706).
// Anfragen zum Plenum (AzP) collect the oral questions of one plenary week, each answered by its own ministry. Read
// with pdftotext -layout, every numbered block ("55. Abgeordneter") has the asker's name in the left column and an
// "Antwort des Staatsministeriums …" line; the statement carries the asker in `value`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { WIKI, log, type Ctx } from '../lib/ctx.ts';
import { addStatement, addEvidence } from '../lib/db.ts';

const run = promisify(execFile);

const RE = /des (?:Bayerischen )?(Staatsministeriums (?:des|der|für) [A-ZÄÖÜa-zäöüß ,]{3,90}?) vom (\d{1,2})\.(\d{2})\.(\d{4})/;

export async function answers(ctx: Ctx): Promise<void> {
  const { db, report } = ctx;
  const files = db.prepare(`SELECT f.id file_id, f.doc_id FROM file f WHERE f.doc_id LIKE 'doc/by-drs-%' AND f.part = 'SA' ORDER BY f.id`).all() as Array<{ file_id: string; doc_id: string }>;
  const pages = db.prepare('SELECT page_no, text FROM page WHERE file_id = ? AND page_no <= 4 ORDER BY page_no');
  const org = db.prepare(`SELECT a.entity_id FROM alias a JOIN entity e ON e.id = a.entity_id WHERE e.type = 'Organization' AND a.alias = ?`);
  let n = 0;
  for (const f of files) {
    let found = false;
    for (const p of pages.all(f.file_id) as Array<{ page_no: number; text: string }>) {
      const text = p.text.replace(/\s+/g, ' ');
      const at = text.indexOf('Antwort');
      const m = at >= 0 ? text.slice(at).match(RE) : null;
      if (!m) continue;
      const name = m[1].replace(/^Staatsministeriums/, 'Staatsministerium');
      const o = org.get(name) as { entity_id: string } | undefined;
      if (!o) { report.add('Answering ministries not in the vocabulary', `${f.doc_id}: ${name}`); found = true; break; }
      const date = `${m[4]}-${m[3]}-${m[2].padStart(2, '0')}`;
      const id = addStatement(db, { subj: f.doc_id, pred: 'answered_for', obj: o.entity_id, start: date, precision: 'day', marker: 'primary', method: 'regex', source: `${f.file_id}#${p.page_no}` });
      addEvidence(db, id, { doc: f.doc_id, file: f.file_id, page: p.page_no, quote: m[0].replace(/^des /, ''), readVia: 'text_layer' });
      found = true;
      n++;
      break;
    }
    if (!found) report.add('Bavarian answers without a recognised ministry heading', f.doc_id);
  }
  report.count('Bavarian answers with the answering ministry', n);
  log(`answers: ${n} of ${files.length} Bavarian Schriftliche Anfragen`);
  await plenum(ctx);
}

async function plenum(ctx: Ctx): Promise<void> {
  const { db, report } = ctx;
  const files = db.prepare(`SELECT f.id file_id, f.doc_id FROM file f WHERE f.doc_id LIKE 'doc/by-drs-%' AND f.part = 'AzP' ORDER BY f.id`).all() as Array<{ file_id: string; doc_id: string }>;
  const askers = db.prepare(`SELECT s.subj, e.label FROM statement s JOIN entity e ON e.id = s.subj WHERE s.pred = 'asked' AND s.obj = ?`);
  const org = db.prepare(`SELECT a.entity_id FROM alias a JOIN entity e ON e.id = a.entity_id WHERE e.type = 'Organization' AND a.alias = ?`);
  let n = 0, total = 0;
  for (const f of files) {
    const { stdout } = await run('pdftotext', ['-layout', '-enc', 'UTF-8', join(WIKI, f.file_id), '-'], { maxBuffer: 1 << 28 });
    const lines = stdout.split('\n');
    // Page of each line (pdftotext separates pages with a form feed).
    const pageOf: number[] = [];
    let pg = 1;
    for (const l of lines) { pageOf.push(pg); pg += (l.match(/\f/g) ?? []).length; }
    const starts = lines.flatMap((l, i) => (/^\f?\s*\d+\.\s+Abgeordnete[r]?\b/.test(l) ? [i] : []));
    const blocks = starts.map((s, k) => {
      const body = lines.slice(s, starts[k + 1] ?? lines.length);
      // Left column only: each line's text up to the first wide gap ("   Mütze              von 700 …" → "Mütze").
      const left = body.slice(0, 8).map((l) => l.replace(/^\f/, '').trim().split(/\s{2,}/)[0]).join(' ').replace(/-\s+/g, '').replace(/\s+/g, ' ');
      const ai = body.findIndex((l) => /^\s*Antwort de[rs] /.test(l));
      return { no: Number(lines[s].match(/(\d+)\./)![1]), left, answer: ai >= 0 ? { line: s + ai, text: body[ai].trim(), next: (body[ai + 1] ?? '').trim() } : null };
    });
    for (const a of askers.all(f.doc_id) as Array<{ subj: string; label: string }>) {
      total++;
      const surname = a.label.split(' ').at(-1)!;
      const mine = blocks.filter((b) => new RegExp(`(?<![\\p{L}])${surname}(?![\\p{L}])`, 'u').test(b.left));
      if (mine.length !== 1 || !mine[0].answer) { report.add('AzP askers without a unique answered question', `${f.doc_id}: ${a.label} (${mine.length} blocks)`); continue; }
      const { line, text, next } = mine[0].answer;
      // "… im Einvernehmen mit dem Staatsministerium …" names a consulted ministry, not the one that answered.
      const name = (t: string) => t.replace(/^Antwort de[rs] /, '').replace(/^Staatsministeriums/, 'Staatsministerium').replace(/^Bayerischen /, '').replace(/ im Einvernehmen.*$/, '');
      let o = org.get(name(text)) as { entity_id: string } | undefined;
      let quote = text;
      if (!o && next && !/^[A-ZÄÖÜ][a-zäöüß]+ [a-zäöüß]/.test(next)) { o = org.get(name(`${text} ${next}`)) as typeof o; quote = `${text} ${next}`; }
      if (!o) { report.add('Answering ministries not in the vocabulary', `${f.doc_id} Nr. ${mine[0].no}: ${name(text)}`); continue; }
      const id = addStatement(db, { subj: f.doc_id, pred: 'answered_for', obj: o.entity_id, value: a.subj, marker: 'primary', method: 'regex', source: `${f.file_id}#${pageOf[line]}` });
      addEvidence(db, id, { doc: f.doc_id, file: f.file_id, page: pageOf[line], quote, readVia: 'text_layer' });
      n++;
    }
  }
  report.count('AzP questions with the answering ministry', n);
  log(`answers: ${n} of ${total} AzP questions in ${files.length} compilations`);
}
