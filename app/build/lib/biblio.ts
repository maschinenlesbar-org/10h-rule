// Deterministic extraction of works outside the parliamentary record from page text: court decisions, legislation in
// the official gazettes, legal literature (journal articles and commentaries) and web sources. Parliamentary documents
// are found by refs.ts. Each pattern needs a form that only citations have (a court name with a decision type and date
// or a file number, a journal with year and page, a gazette with page and year), so the many mentions of courts in
// permit tables ("beim VGH anhängig") and of ministry file numbers ("Az.: IB1-1404.2-112") are not taken as works.

export type WorkKind = 'court' | 'legislation' | 'literature' | 'web';

export interface WorkRef {
  key: string;       // identity: two references with the same key are the same work
  kind: WorkKind;
  label: string;     // citation as displayed
  url: string | null;
  raw: string;
  index: number;
  detail: Record<string, string>; // court, date, az, collection, journal, year, page, authors, gazette, host
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mär: '03', mar: '03', apr: '04', mai: '05', jun: '06', jul: '07', aug: '08', sep: '09',
  okt: '10', nov: '11', dez: '12' };
const MONTH = String.raw`(?:\d{1,2}\.|Jan(?:uar|\.)?|Feb(?:ruar|\.)?|März|Mär\.|Apr(?:il|\.)?|Mai|Juni?\.?|Juli?\.?|Aug(?:ust|\.)?|Sep(?:tember|t\.|\.)?|Okt(?:ober|\.)?|Nov(?:ember|\.)?|Dez(?:ember|\.)?)`;
const DATE = String.raw`\d{1,2}\.\s?${MONTH}\s?(?:19|20)?\d{2}`;

// "7. März 2016", "29. Aug. 2007", "05.10.2012", "17.10.13" → ISO date, or null.
export function isoDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\.\s?(?:(\d{1,2})\.|([A-Za-zäÄ]{3})[a-zä]*\.?)\s?(\d{2,4})/);
  if (!m) return null;
  const month = m[2] ? m[2].padStart(2, '0') : MONTHS[m[3].toLowerCase()];
  if (!month) return null;
  const year = m[4].length === 2 ? (Number(m[4]) > 40 ? `19${m[4]}` : `20${m[4]}`) : m[4];
  return `${year}-${month}-${m[1].padStart(2, '0')}`;
}
const fmt = (iso: string) => iso.split('-').reverse().join('.');

// Courts, with long names mapped to the usual abbreviation.
const COURT = String.raw`(?:BVerfG|BVerwG|BGH|BSG|BFH|BAG|EuGH|EGMR|BayVerfGH|BayVGH|SächsVerfGH|SachsAnhVerfG|SächsOVG|NdsOVG|HessVGH|`
  + String.raw`VerfGH\s+(?:NRW|Rheinland-Pfalz|RP|Berlin|Sachsen)|OVG\s+(?:NRW|Berlin-Brandenburg|[A-ZÄÖÜ][a-zäöü]+(?:-[A-ZÄÖÜ][a-zäöü]+)?)|`
  + String.raw`VGH\s+(?:BW|Baden-Württemberg|Mannheim|Kassel|München)|VG\s+[A-ZÄÖÜ][a-zäöü]+(?:\s(?:an der|a\.\s?d\.)\s[A-ZÄÖÜ][a-zäöü]+)?|`
  + String.raw`OLG\s+[A-ZÄÖÜ][a-zäöü]+|Oberlandesgericht\s+[A-ZÄÖÜ][a-zäöü]+|Bundesverfassungsgericht|Bundesverwaltungsgericht|Bundesgerichtshof|`
  + String.raw`Bundessozialgericht|Bayerische[rn]?\s+Verwaltungsgerichtshof|Bayerische[rn]?\s+Verfassungsgerichtshof)`;
const LONG: Array<[RegExp, string]> = [[/^Bundesverfassungsgericht$/, 'BVerfG'], [/^Bundesverwaltungsgericht$/, 'BVerwG'], [/^Bundesgerichtshof$/, 'BGH'],
  [/^Bundessozialgericht$/, 'BSG'], [/^Bayerische[rn]?\s+Verwaltungsgerichtshof$/, 'BayVGH'], [/^Bayerische[rn]?\s+Verfassungsgerichtshof$/, 'BayVerfGH'],
  [/^VGH\s+München$/, 'BayVGH'], [/^VGH\s+(?:Mannheim|Baden-Württemberg)$/, 'VGH BW'], [/^Oberlandesgericht\s+/, 'OLG '],
  // Oberverwaltungsgerichte are cited by seat or by Land.
  [/^OVG\s+Schleswig$/, 'OVG Schleswig-Holstein'], [/^OVG\s+Koblenz$/, 'OVG Rheinland-Pfalz'], [/^OVG\s+(?:Münster|Nordrhein-Westfalen)$/, 'OVG NRW'],
  [/^OVG\s+Greifswald$/, 'OVG Mecklenburg-Vorpommern'], [/^OVG\s+(?:Lüneburg|Niedersachsen)$|^NdsOVG$/, 'OVG Niedersachsen'], [/^OVG\s+Bautzen$|^SächsOVG$/, 'OVG Sachsen'],
  [/^OVG\s+Magdeburg$/, 'OVG Sachsen-Anhalt'], [/^OVG\s+Berlin$/, 'OVG Berlin-Brandenburg'], [/^VGH\s+Kassel$|^HessVGH$/, 'VGH Hessen']];
const courtName = (s: string) => LONG.reduce((c, [re, to]) => c.replace(re, to), s.replace(/\s+/g, ' '));

// Court file numbers: "4 C 2/07", "1 A 11186/08", "22 BV 08.3427", "1 BvR 1676/01", "B 2 K 15.77", "OVG 11 N 50.10", "Vf. 87-I-06".
const AZ = String.raw`(?:(?:[A-Z]{1,3}|OVG)\s)?\d{1,2}\s?[A-Z][A-Za-z]{0,3}\s?\d{1,5}[./]\s?\d{2,4}(?:\s[A-Z]{1,2}\b)?|Vf\.\s?\d+-[IVX]+-?\d{2}|LVG\s\d+\/\d{2}`;
const TYPE = String.raw`(Urt(?:eil|\.)|Beschl(?:uss|\.)|Nichtannahmebeschluss|Gutachten|Entsch(?:eidung|\.))`;
const typeLabel = (s: string) => s.startsWith('Urt') ? 'Urteil' : s.startsWith('Beschl') ? 'Beschluss' : s.startsWith('Entsch') ? 'Entscheidung' : s;
const normAz = (s: string) => s.replace(/\s*([./])\s*/g, '$1').replace(/\s+/g, ' ').trim();
// "4 C 2/07" and "4 C 2.07" are the same file number (courts changed the separator); "Vf. 87-I06" and "Vf.87-I-06" too.
const azKey = (az: string) => az.replace(/\//g, '.').replace(/^Vf\.\s?/, 'Vf.').replace(/-([IVX]+)-?(\d{2})$/, '-$1-$2');

const COLLECTIONS = String.raw`BVerfGE|BVerwGE|BGHZ|BGHSt|BSGE|BFHE|VerfGHE|VGH\s?n\.\s?F\.`;

// Journals of public and environmental law cited in this corpus. Short names that collide with ordinary words are left out.
const JOURNALS = String.raw`NVwZ-RR|NVwZ|DVBl\.?|BayVBl\.?|ZUR|NuR|UPR|DÖV|NJW|ZfBR|BauR|EnWZ|ZNER|KommJur|VerwArch|JZ|NordÖR|LKV|SächsVBl\.?|`
  + String.raw`ThürVBl\.?|NdsVBl\.?|VBlBW|NWVBl\.?|EurUP|RdE|AöR|ZRP|NZBau|I\+E|DVP`;
// Codes that commentaries are named after.
const CODES = String.raw`BauGB|BauNVO|BImSchG|BayBO|GG|ROG|EEG|BNatSchG|UVPG|VwVfG|VwGO|BayLplG|BV|SächsBO|BbgBO|LBO`;
const AUTHOR = String.raw`[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?`;

const GAZETTE = String.raw`(BGBl\.?\s?I{1,2}\b\.?|GVBl\.?(?:\s?(?:LSA|NRW|BE|Bln))?|SächsGVBl\.?|GVOBl\.?(?:\s?(?:M-V|Schl\.-H\.))?|Nds\.\s?GVBl\.?|BayMBl\.?|AllMBl\.?|GBl\.?)`;
const GAZETTE_LABEL = (g: string) => g.replace(/\s+/g, ' ').replace(/^BGBl\.?\s?(I{1,2})\.?$/, 'BGBl. $1').replace(/^GVBl$/, 'GVBl.').replace(/^SächsGVBl$/, 'SächsGVBl.');

// Bare domains that are imprints, footers or publishers' addresses, not sources (also: bare domains in 3+ documents,
// see the bibliography step).
export const IGNORE_HOSTS = new Set(['www.betrifft-gesetze.de', 'www.heenemann-druck.de', 'www.satzweiss.com', 'www.printsystem.de', 'www.bundesanzeiger-verlag.de']);

type Made = Omit<WorkRef, 'raw' | 'index'> | null;
interface Pattern { re: RegExp; make: (m: RegExpExecArray, t: string) => Made }

const PATTERNS: Pattern[] = [
  // Court + decision type + date [+ file number]: "BVerwG, Urt. vom 29. Aug. 2007, Az. 4 C 2/07"
  { re: new RegExp(String.raw`\b(${COURT})(?:\s*\([A-Za-zÄÖÜäöü]+\))?,?\s+(?:hat\s+(?:in seinem [a-z]+en\s+|mit\s+)?)?${TYPE}\s+v(?:om|\.)\s+(${DATE})(?:\s*[,–—-]\s*(?:Az\.?:?\s*)?(${AZ}))?`, 'g'),
    make: (m) => court(m[1], typeLabel(m[2]), isoDate(m[3]), m[4] ? normAz(m[4]) : null) },
  // Court + file number: "BVerwG 6 C 60.14", "BayVGH, 22 CS 14.2157"
  { re: new RegExp(String.raw`\b(${COURT}),?\s+(?:Az\.?:?\s*)?(${AZ})(?![\w/])`, 'g'),
    make: (m) => court(m[1], null, null, normAz(m[2])) },
  // Official collections: "BVerfGE 124, 161", "BVerwGE 34, 301"
  { re: new RegExp(String.raw`\b(${COLLECTIONS})\s+(\d{1,3}),\s*(\d{1,4})\b`, 'g'),
    make: (m) => {
      const coll = m[1].replace(/\s+/g, ' ');
      const label = `${coll} ${m[2]}, ${m[3]}`;
      return { key: `court|${label}`, kind: 'court', label, url: null, detail: { collection: coll, volume: m[2], page: m[3] } };
    } },
  // Journal articles: "Grüner, NVwZ 2015, 108", "NVwZ 2015, S. 1093", "ZfBR 2016, 159"
  { re: new RegExp(String.raw`(?:\b(${AUTHOR}(?:\/${AUTHOR})?),\s+(?:in:\s+)?)?\b(${JOURNALS})\s*(?:(\d{4})|\((\d{4})\)),?\s*(?:S\.\s*)?(\d{1,4})(?!\d)`, 'g'),
    make: (m, t): Made => {
      const journal = m[2].replace(/\.$/, '') + (/^(DVBl|BayVBl|SächsVBl|ThürVBl|NdsVBl|NWVBl)$/.test(m[2].replace(/\.$/, '')) ? '.' : '');
      const year = m[3] ?? m[4];
      if (Number(year) < 1949 || Number(year) > 2030) return null;
      const label = `${journal} ${year}, ${m[5]}`;
      const before = t.slice(Math.max(0, m.index - 14), m.index);
      // A court in front ("VGH Mannheim, ZfBR 2016, 159"): a decision printed in the journal.
      const court = m[1] && before.match(/\b(BVerfG|BVerwG|BGH|OVG|VGH|VG|OLG|LG)\s+$/);
      if (court) {
        const c = courtName(`${court[1]} ${m[1]}`);
        return { key: `court|${c}|${label}`, kind: 'court', label: `${c}, ${label}`, url: null, detail: { court: c, journal, year, page: m[5] } };
      }
      // A name counts as author only where a citation starts: after "vgl.", a footnote number, a bracket or a semicolon.
      // Otherwise it is the last word of a title ("… auf dem Prüfstand, NVwZ 2015, 1093").
      const authors = m[1] && /(?:^|[(;:]\s*|\b(?:[Vv]gl|[Ss]iehe|auch|so|ebenso|etwa|dazu|ferner)\.?\s+|\b\d{1,3}\s+)$/.test(before) ? m[1] : '';
      return { key: `literature|${label}`, kind: 'literature', label: authors ? `${authors}, ${label}` : label, url: null,
        detail: { journal, year, page: m[5], ...(authors ? { authors } : {}) } };
    } },
  // Commentaries: "Battis/Krautzberger/Löhr, BauGB", "Jarass, BImSchG, 11. Aufl. 2015", "in: Dreier (Hrsg.), GG"
  { re: new RegExp(String.raw`\b(${AUTHOR}(?:\/${AUTHOR})+),\s+(${CODES})\b|\b(${AUTHOR}),\s+(${CODES}),\s*\d{1,2}\.\s?Aufl|\bin:\s+(${AUTHOR}(?:\/${AUTHOR})*)\s*(?:\(Hrsg\.\))?,\s+(${CODES})\b`, 'g'),
    make: (m) => {
      const authors = m[1] ?? m[3] ?? m[5], code = m[2] ?? m[4] ?? m[6];
      if (/^(Bund|Land|Länder|Bayern|Sachsen)$/.test(authors)) return null;
      const label = `${authors}, ${code}`;
      return { key: `literature|${label}`, kind: 'literature', label, url: null, detail: { authors, code, form: 'commentary' } };
    } },
  // Gazettes: "BGBl. I S. 1748", "GVBl S. 478", "BGBl. I 2014, S. 954"; the year comes from the citation or the date before it.
  { re: new RegExp(String.raw`\b${GAZETTE}\s*(?:((?:19|20)\d{2})\s*,?\s*)?(?:Nr\.\s*\d+\s*,?\s*)?S\.\s*(\d{1,5})(?!\d)`, 'g'),
    make: (m, t) => {
      const before = t.slice(Math.max(0, m.index - 90), m.index);
      const year = m[2] ?? [...before.matchAll(/(?:19|20)\d{2}/g)].at(-1)?.[0];
      if (!year) return null; // without a year the page number does not identify the issue
      const gazette = GAZETTE_LABEL(m[1]);
      const label = `${gazette} ${year} S. ${m[3]}`;
      return { key: `legislation|${label}`, kind: 'legislation', label, url: null, detail: { gazette, year, page: m[3] } };
    } },
  // Web addresses
  { re: /\b(?:https?:\/\/|www\.)[^\s)>"“”„]+/gi,
    make: (m) => {
      const clean = m[0].replace(/[.,;:)\]“”"'’]+$/, '');
      const bare = clean.replace(/^https?:\/\//i, '');
      const host = bare.split('/')[0].toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || IGNORE_HOSTS.has(host)) return null; // cut by a line break, or an imprint
      const path = bare.slice(host.length).replace(/\/$/, '');
      const url = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
      return { key: `web|${host}${path}`, kind: 'web', label: `${host}${path}`, url, detail: { host, ...(path ? { path } : {}) } };
    } },
];

function court(name: string, type: string | null, date: string | null, az: string | null): Made {
  const c = courtName(name);
  if (!date && !az) return null;
  const label = [c, type && date ? `${type} vom ${fmt(date)}` : date ? fmt(date) : null, az].filter(Boolean).join(', ');
  // One decision, one entry: by file number when there is one, else by court and date.
  return { key: `court|${c}|${az ? azKey(az) : date}`, kind: 'court', label, url: null, detail: { court: c, ...(type ? { type } : {}), ...(date ? { date } : {}), ...(az ? { az } : {}) } };
}

// Hyphenated line breaks joined, whitespace collapsed (same as refs.ts), so citations split across lines are found.
export function extractWorks(text: string): WorkRef[] {
  const t = text.replace(/(\w)-\n(\w)/g, '$1$2').replace(/\s+/g, ' ');
  const out: WorkRef[] = [];
  const taken: Array<[number, number]> = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(t))) {
      const start = m.index, end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue; // an earlier, more specific pattern matched here
      const w = p.make(m, t);
      if (!w) continue;
      taken.push([start, end]);
      out.push({ ...w, raw: m[0], index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// A page is "about wind power" when it says so; compiled Anfragen documents also hold answers on unrelated topics.
export const onTopic = (text: string): boolean => /wind|\b10\s?-?\s?H\b/i.test(text);
