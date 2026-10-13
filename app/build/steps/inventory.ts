// Step 1: manifests → document and file rows, with SHA-256 verification.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WIKI, log, type Ctx } from '../lib/ctx.ts';
import { docIdFromFilename } from '../lib/ids.ts';
import { parliamentOf } from '../lib/refs.ts';
import { mdTables, plain, mdLinks, parseDate } from '../lib/text.ts';
import { upsertEntity } from '../lib/db.ts';

const ARCHIVES = ['pdfs', ...readdirSync(join(WIKI, 'anfragen'), { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => `anfragen/${d.name}`)];

export interface DocMeta { title?: string; type?: string; date?: string }

const KIND: Array<[RegExp, string]> = [
  [/^doc\/(bt|br|by|sn|mv|ni)-drs-/, 'Drucksache'],
  [/^doc\/(bt|br|by|sn)-plpr-/, 'Plenarprotokoll'],
  [/^doc\/sn-apr-/, 'Ausschussprotokoll'],
  [/^doc\/sh-umdruck-/, 'Umdruck'],
  [/^doc\/wd-/, 'Ausarbeitung der Wissenschaftlichen Dienste'],
  [/^doc\/bayverfgh-/, 'Entscheidung'],
  [/^doc\/by-gvbl-/, 'Gesetzblatt'],
  [/^doc\/fds-/, 'IFG-Bescheid oder Anlage'],
];
export const kindOf = (id: string) => KIND.find(([re]) => re.test(id))?.[1] ?? 'Dokument';

export function numberOf(id: string): { number: string | null; wp: number | null } {
  let m = id.match(/^doc\/(?:bt|by|sn|mv|ni)-(?:drs|plpr)-(\d+)-(\d+)$/);
  if (m) return { number: `${m[1]}/${m[2]}`, wp: Number(m[1]) };
  m = id.match(/^doc\/br-drs-(\d+)-(\d+)(-b)?$/);
  if (m) return { number: `${m[1]}/${m[2]}${m[3] ? '(B)' : ''}`, wp: null };
  m = id.match(/^doc\/br-drs-(\d+)-(\d)-(\d+)$/);
  if (m) return { number: `${m[1]}/${m[2]}/${m[3]}`, wp: null };
  m = id.match(/^doc\/br-plpr-(\d+)$/);
  if (m) return { number: m[1], wp: null };
  m = id.match(/^doc\/wd-(\d+)-(\d+)-(\d+)$/);
  if (m) return { number: `WD ${m[1]} - 3000 - ${m[2]}/${m[3]}`, wp: null };
  return { number: null, wp: null };
}

const ISSUER: Record<string, string> = { bt: 'Deutscher Bundestag', br: 'Bundesrat', by: 'Bayerischer Landtag', sn: 'Sächsischer Landtag',
  mv: 'Landtag Mecklenburg-Vorpommern', ni: 'Niedersächsischer Landtag', sh: 'Schleswig-Holsteinischer Landtag' };

// Titles, types and dates from the archive README tables (keyed by file name).
function readmeMeta(): Map<string, DocMeta> {
  const meta = new Map<string, DocMeta>();
  for (const readme of ['pdfs/README.md', 'anfragen/README.md']) {
    for (const t of mdTables(readFileSync(join(WIKI, readme), 'utf8'))) {
      const iFile = t.headers.indexOf('File');
      if (iFile < 0) continue;
      const col = (name: string) => t.headers.findIndex((h) => h.startsWith(name));
      for (const r of t.rows) {
        const file = mdLinks(r[iFile])[0]?.text ?? plain(r[iFile]);
        const title = r[col('Document')] ?? r[col('Title')] ?? r[col('Topic')];
        const date = r[col('Date')] ?? r[col('Filed')];
        meta.set(file, { title: title ? plain(title) : undefined, type: r[col('Type')] ? plain(r[col('Type')]) : undefined,
          date: date ? parseDate(plain(date).split(' → ')[0])?.iso : undefined });
      }
    }
  }
  return meta;
}

export function inventory(ctx: Ctx): void {
  const { db, report } = ctx;
  const meta = readmeMeta();
  const insFile = db.prepare('INSERT INTO file (id, doc_id, part, source_url, bytes, sha256, pages) VALUES (?, ?, ?, ?, ?, ?, NULL)');
  const listed = new Set<string>();
  for (const dir of ARCHIVES) {
    const manifest = join(WIKI, dir, 'manifest.tsv');
    if (!existsSync(manifest)) continue;
    for (const line of readFileSync(manifest, 'utf8').split('\n').filter(Boolean)) {
      const [name, url, bytes, sha] = line.split('\t');
      const rel = `${dir}/${name}`;
      listed.add(rel);
      const path = join(WIKI, rel);
      if (!existsSync(path)) { report.add('Missing files', rel); continue; }
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (actual !== sha) report.add('Checksum mismatches', `${rel}: manifest ${sha.slice(0, 12)}…, file ${actual.slice(0, 12)}…`);
      const docId = docIdFromFilename(name);
      const m = meta.get(name) ?? {};
      const parl = parliamentOf(docId);
      const { number, wp } = numberOf(docId);
      const label = number ? `${parl ? parl.toUpperCase() + ' ' : ''}${kindOf(docId).replace('Drucksache', 'Drs')} ${number}` : (m.title ?? name);
      upsertEntity(db, docId, 'Document', label, {});
      db.prepare(`INSERT INTO document (id, kind, issuer, parliament, number, wp, date, title, source_url, archived)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                  ON CONFLICT(id) DO UPDATE SET archived = 1, title = coalesce(document.title, excluded.title),
                    date = coalesce(document.date, excluded.date)`)
        .run(docId, kindOf(docId), parl ? ISSUER[parl] ?? null : null, parl, number, wp, m.date ?? null, m.title ?? null, url);
      const part = name.match(/_(KA|Antwort|Antwort-Ergaenzung|SA|AzP|Antrag|Stellungnahme-SMI)\b/)?.[1] ?? null;
      insFile.run(rel, docId, part, url, Number(bytes), sha);
      report.count('Files in manifests');
    }
  }
  for (const dir of ARCHIVES) {
    for (const f of readdirSync(join(WIKI, dir))) {
      if (/\.(pdf|docx)$/i.test(f) && !listed.has(`${dir}/${f}`)) report.add('Files on disk but not in a manifest', `${dir}/${f}`);
    }
  }
  const n = db.prepare('SELECT count(*) n FROM document').get() as { n: number };
  report.count('Archived documents', n.n);
  log(`inventory: ${listed.size} files, ${n.n} documents`);
}
