// Deterministic extraction of document and law references from text.
// Prefixed forms ("BT-Drs 18/1310") resolve on their own. Bare forms ("Drucksache 17/554") need the
// parliament of the surrounding document or wiki page as context; without it they are reported, not guessed.

import { slug } from './ids.ts';

export type Parliament = 'bt' | 'br' | 'by' | 'sn' | 'mv' | 'ni' | 'sh' | null;

export interface Ref {
  id: string | null; // canonical entity id, or null when unresolved
  kind: 'doc' | 'law';
  raw: string;
  index: number;
}

const pad3 = (n: string) => n.padStart(3, '0');

// Wahlperioden that exist (explicit prefix) and that occur in this corpus (bare numbers, resolved by context only).
const WP_ANY: Record<string, [number, number]> = { bt: [1, 21], by: [1, 19], sn: [1, 8], mv: [1, 8], ni: [1, 19], sh: [1, 20] };
const WP_CORPUS: Record<string, [number, number]> = { bt: [16, 20], by: [15, 18], sn: [4, 7], mv: [5, 7], ni: [16, 18], sh: [17, 19] };

function drs(parl: string, wp: string, nr: string, bare = false): string | null {
  const [lo, hi] = (bare ? WP_CORPUS : WP_ANY)[parl] ?? [0, 99];
  const w = Number(wp);
  if (w < lo || w > hi) return null;
  return `doc/${parl}-drs-${w}-${Number(nr)}`;
}

interface Pattern {
  re: RegExp;
  resolve: (m: RegExpExecArray, ctx: Parliament) => string | null;
  kind?: 'doc' | 'law';
}

const D = String.raw`(?:Drucksachen?|Drs\.?)`;

const PATTERNS: Pattern[] = [
  // Bundesrat committee recommendations: 155/1/14
  { re: new RegExp(String.raw`(?:BR-${D}|Bundesratsdrucksache|${D})\s*(\d{1,4})\/(\d)\/(\d{2})(?!\d)`, 'g'),
    resolve: (m) => `doc/br-drs-${Number(m[1])}-${m[2]}-${m[3]}` },
  // Bundesrat Drucksachen, optionally (B) = Beschluss
  { re: new RegExp(String.raw`(?:BR-${D}|BR-Drucksache|Bundesratsdrucksache)\s*(\d{1,4})\/(\d{2})(?!\d)\s*(\(B\))?`, 'g'),
    resolve: (m) => `doc/br-drs-${Number(m[1])}-${m[2]}${m[3] ? '-b' : ''}` },
  { re: /BR-PlPr\.?\s*(\d{3,4})(?!\d)/g, resolve: (m) => `doc/br-plpr-${m[1]}` },
  // Bundestag
  { re: new RegExp(String.raw`(?:BT-${D}|BT-Drucksache|Bundestagsdrucksache|Bundestags-Drucksache)\s*(\d{1,2})\/(\d{1,5})(?!\d)`, 'g'),
    resolve: (m) => drs('bt', m[1], m[2]) },
  // Land Drucksachen with explicit prefix (LT-Drs is used for Bayern in this wiki)
  { re: new RegExp(String.raw`\b(BY|LT|SN|MV|NI)[- ]${D}\s*(\d{1,2})\/(\d{1,5})(?!\d)`, 'g'),
    resolve: (m) => drs(m[1] === 'LT' ? 'by' : m[1].toLowerCase(), m[2], m[3]) },
  { re: /\b(BY|SN)[- ]PlPr\.?\s*(\d{1,2})\/(\d{1,3})(?!\d)/g, resolve: (m) => `doc/${m[1].toLowerCase()}-plpr-${m[2]}-${Number(m[3])}` },
  { re: /\bSH[- ]Umdruck\s*(\d{2})\/(\d{1,5})/g, resolve: (m) => `doc/sh-umdruck-${m[1]}-${m[2]}` },
  // Bundestag research services: "WD 7 - 3000 - 042/19", "WD 7-042/19"
  { re: /\bWD\s*(\d{1,2})\s*-\s*(?:3000\s*-\s*)?(\d{1,3})\/(\d{2})(?!\d)/g, resolve: (m) => `doc/wd-${m[1]}-${pad3(m[2])}-${m[3]}` },
  { re: /\bVf\.\s*(\d+)-([IVX]+)-(\d{2})/g, resolve: (m) => `doc/bayverfgh-vf-${m[1]}-${m[2].toLowerCase()}-${m[3]}` },
  // Plenarprotokolle: prefixed BT, or bare with context
  { re: /\b(?:BT-PlPr|PlPr\.?|Plenarprotokoll)\s*(\d{1,2})\/(\d{1,3})(?!\d)/g,
    resolve: (m, ctx) => {
      const parl = ctx === 'by' || ctx === 'sn' ? ctx : 'bt';
      return `doc/${parl}-plpr-${m[1]}-${Number(m[2])}`;
    } },
  // Bare Drucksache: needs context
  { re: new RegExp(String.raw`\b${D}\s*(\d{1,4})\/(\d{1,5})(?!\d|\/)`, 'g'),
    resolve: (m, ctx) => {
      if (!ctx) return null;
      if (ctx === 'br') return /^\d{2}$/.test(m[2]) ? `doc/br-drs-${Number(m[1])}-${m[2]}` : null;
      return drs(ctx, m[1], m[2], true);
    } },
  // Laws: paragraphs and articles
  { kind: 'law',
    re: /§\s*(\d+[a-z]?)(?:\s*Abs(?:atz|\.)\s*(\d+))?(?:\s*(?:Satz|S\.)\s*\d+)?(?:\s*(?:Nr\.|Nummer)\s*(\d+))?\s+(BauGB|BauNVO|BImSchG|ROG|EEG(?: 2014)?|UIG|IFG|GO-BT|GO)\b/g,
    resolve: (m) => lawId(m[4], m[1], m[2], m[3]) },
  { kind: 'law',
    re: /\bArt(?:ikel|\.)\s*(\d+[a-z]?)(?:\s*Abs(?:atz|\.)\s*(\d+))?(?:\s*Satz\s*\d+)?(?:\s*Nr\.\s*(\d+))?\s+(BayBO|GG|BV|BayUIG|BayDSG|SächsVerf|SachsVerf)\b/g,
    resolve: (m) => lawId(m[4], m[1], m[2], m[3]) },
];

export function lawId(code: string, para: string, abs?: string, nr?: string): string {
  const c = slug(code.replace(/^SachsVerf$/, 'SächsVerf').replace(/ 2014$/, ''));
  return ['law/' + c, para.toLowerCase(), abs, nr].filter(Boolean).join('-');
}

export function lawLabel(id: string): string {
  const [code, para, abs, nr] = id.replace(/^law\//, '').split('-');
  const CODES: Record<string, string> = { baugb: 'BauGB', baunvo: 'BauNVO', bimschg: 'BImSchG', rog: 'ROG', eeg: 'EEG', uig: 'UIG', ifg: 'IFG', go: 'GO-BT',
    baybo: 'BayBO', gg: 'GG', bv: 'BV', bayuig: 'BayUIG', baydsg: 'BayDSG', saechsverf: 'SächsVerf' };
  const isArt = ['baybo', 'gg', 'bv', 'bayuig', 'baydsg', 'saechsverf'].includes(code);
  return `${isArt ? 'Art.' : '§'} ${para}${abs ? ` Abs. ${abs}` : ''}${nr ? ` Nr. ${nr}` : ''} ${CODES[code] ?? code}`;
}

// Join hyphenated line breaks and collapse whitespace so references split across lines are found.
export function normalizeText(t: string): string {
  return t.replace(/(\w)-\n(\w)/g, '$1$2').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, ' ');
}

// keepOffsets: only replace line breaks and tabs by spaces (same length), so ref.index points into the original text.
// Hyphenated line breaks are then not joined, which loses a few references; use it for display, not for extraction.
export function extractRefs(text: string, ctx: Parliament, opts: { keepOffsets?: boolean } = {}): Ref[] {
  const t = opts.keepOffsets ? text.replace(/[\n\t\r\u00a0]/g, ' ') : normalizeText(text);
  const out: Ref[] = [];
  const taken: Array<[number, number]> = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(t))) {
      const start = m.index, end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue; // an earlier, more specific pattern already matched here
      taken.push([start, end]);
      out.push({ id: p.resolve(m, ctx), kind: p.kind ?? 'doc', raw: m[0], index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// Parliament that issued a document, used as context for bare references in its text.
export function parliamentOf(docId: string): Parliament {
  const m = docId.match(/^doc\/(bt|br|by|sn|mv|ni|sh|wd|bayverfgh)-/);
  if (!m) return null;
  if (m[1] === 'wd') return 'bt';
  if (m[1] === 'bayverfgh') return 'by';
  return m[1] as Parliament;
}
