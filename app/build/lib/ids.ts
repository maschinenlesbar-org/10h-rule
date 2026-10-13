// Stable, readable ids. Everything that becomes a primary key goes through here.

const TRANSLIT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue' };

export function slug(s: string): string {
  return s
    .replace(/[äöüßÄÖÜ]/g, (c) => TRANSLIT[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const pad3 = (n: string) => n.padStart(3, '0');

// Map an archive file name (without directory) to the id of the logical document it belongs to.
// Several files can belong to one document (e.g. question and answer of a Saxon Kleine Anfrage).
export function docIdFromFilename(file: string): string {
  const stem = file.replace(/\.[a-z]+$/i, '');
  const rules: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/^BT-Drs_(\d+)-(\d+)/, (m) => `bt-drs-${m[1]}-${m[2]}`],
    [/^BT-PlPr_(\d+)-(\d+)/, (m) => `bt-plpr-${m[1]}-${m[2]}`],
    [/^BR-Drs_(\d+)-(\d)-(\d{2})(?!\d)/, (m) => `br-drs-${m[1]}-${m[2]}-${m[3]}`],
    [/^BR-Drs_(\d+)-(\d{2})(B?)/, (m) => `br-drs-${m[1]}-${m[2]}${m[3] ? '-b' : ''}`],
    [/^BR-PlPr_(\d+)/, (m) => `br-plpr-${m[1]}`],
    [/^BY-Drs_(\d+)-(\d+)/, (m) => `by-drs-${m[1]}-${m[2]}`],
    [/^BY-PlPr_(\d+)-(\d+)/, (m) => `by-plpr-${m[1]}-${m[2]}`],
    [/^BY-GVBl_(\d{4})-\d+_S(\d+)/, (m) => `by-gvbl-${m[1]}-${m[2]}`],
    [/^SN-Drs_(\d+)-(\d+)/, (m) => `sn-drs-${m[1]}-${m[2]}`],
    [/^SN-APr_(\d+)-(\d+)-(\d+[A-Z]?)/, (m) => `sn-apr-${m[1]}-${m[2]}-${m[3].toLowerCase()}`],
    [/^(MV|NI)-Drs_(\d+)-(\d+)/, (m) => `${m[1].toLowerCase()}-drs-${m[2]}-${m[3]}`],
    [/^SH-Umdruck_(\d+)-(\d+)/, (m) => `sh-umdruck-${m[1]}-${m[2]}`],
    [/^WD-(\d+)-(\d+)-(\d{2})/, (m) => `wd-${m[1]}-${pad3(m[2])}-${m[3]}`],
    [/^BayVerfGH_.*Vf-(\d+)-([IVX]+)-(\d+)/, (m) => `bayverfgh-vf-${m[1]}-${m[2].toLowerCase()}-${m[3]}`],
  ];
  for (const [re, f] of rules) {
    const m = stem.match(re);
    if (m) return `doc/${f(m)}`;
  }
  return `doc/${slug(stem)}`;
}

export const personId = (fileStem: string) => `person/${fileStem}`;
