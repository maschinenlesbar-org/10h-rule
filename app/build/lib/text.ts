// Small parsers: CSV, markdown tables, markers and German dates.

import { readFileSync } from 'node:fs';

// Lines starting with "#" before the header are comments (provenance notes).
export function readCsv(path: string): Array<Record<string, string>> {
  const rows = parseCsv(readFileSync(path, 'utf8').replace(/^(#[^\n]*\n)+/, ''));
  const [head, ...body] = rows;
  return body.filter((r) => r.some((c) => c !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Only http(s) addresses become links: a "javascript:" or "data:" URL in a manifest or a wiki link would run in the site.
export const httpUrl = (u: string | null | undefined): string | null => (u && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : null);

export function toCsv(rows: Array<Record<string, string>>, cols: string[]): string {
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

export interface MdTable {
  heading: string; // nearest preceding heading
  headers: string[];
  rows: string[][];
  line: number; // 1-based line of the header row
}

// Pipe tables only. Cells are split on unescaped pipes outside of inline code and links.
export function mdTables(src: string): MdTable[] {
  const lines = src.split('\n');
  const tables: MdTable[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,6} /.test(l)) heading = l.replace(/^#+ /, '').trim();
    if (l.startsWith('|') && /^\|\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const t: MdTable = { heading, headers: splitRow(l), rows: [], line: i + 1 };
      i += 2;
      while (i < lines.length && lines[i].startsWith('|')) t.rows.push(splitRow(lines[i++]));
      tables.push(t);
      i--;
    }
  }
  return tables;
}

function splitRow(l: string): string[] {
  const cells: string[] = [];
  let cur = '', brackets = 0, url = false, code = false;
  const s = l.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') code = !code;
    if (!code && !url) {
      if (c === '[') brackets++;
      if (c === ']') { brackets = Math.max(0, brackets - 1); if (s[i + 1] === '(') url = true; }
    } else if (url && c === ')') url = false;
    if (c === '|' && !code && !url && brackets === 0 && s[i - 1] !== '\\') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

export interface MdLink { text: string; url: string }
export function mdLinks(s: string): MdLink[] {
  return [...s.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => ({ text: m[1], url: m[2] }));
}

// Markdown to plain text: drop links (keep text), emphasis, html breaks.
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Marker = 'primary' | 'secondary' | 'unverified';
export function markerOf(s: string): Marker {
  if (/\[not verified\]|\[outcome not verified\]|not verified in primary/i.test(s)) return 'unverified';
  if (/\[secondary\]|\[partly secondary\]/i.test(s)) return 'secondary';
  return 'primary';
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mär: 3, märz: 3, mar: 3, march: 3, apr: 4, april: 4,
  mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dez: 12, dezember: 12, dec: 12, december: 12,
};

export interface ParsedDate { iso: string; end?: string; precision: 'day' | 'month' | 'year' }

// "05.03.2013", "05./06.11.2015", "01/2015", "Aug 2013", "2014", "Spring 2013" (→ null)
export function parseDate(s: string): ParsedDate | null {
  const t = plain(s);
  let m = t.match(/^(\d{2})\.\/(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return { iso: `${m[4]}-${m[3]}-${m[1]}`, end: `${m[4]}-${m[3]}-${m[2]}`, precision: 'day' };
  m = t.match(/^(\d{2})\.(\d{2})\.\s*[–-]\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return { iso: `${m[5]}-${m[2]}-${m[1]}`, end: `${m[5]}-${m[4]}-${m[3]}`, precision: 'day' };
  m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return { iso: `${m[3]}-${m[2]}-${m[1]}`, precision: 'day' };
  m = t.match(/^(\d{2})\/(\d{4})$/);
  if (m) return { iso: `${m[2]}-${m[1]}`, precision: 'month' };
  m = t.match(/^([A-Za-zä]+)\.? (\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return { iso: `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}`, precision: 'month' };
  m = t.match(/^(\d{4})$/);
  if (m) return { iso: m[1], precision: 'year' };
  return null;
}
