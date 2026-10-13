// Person data from abgeordnetenwatch.de and DIP, turned into labelled text. Shared by the entity view and the static
// entity pages of the export, which render it as DOM and as HTML.
import type { PersonProfile, AwMandate } from './types.ts';

// [15, 16, 17, 18] → "15–18"; [16, 18] → "16, 18"
export function wpList(ns: number[]): string {
  const s = [...new Set(ns)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(', ');
}

const ROLE: Record<string, string> = { member: 'member', alternate_member: 'alternate', chairperson: 'chair', deputy_chairperson: 'deputy chair',
  foreperson: 'spokesperson', deputy_foreperson: 'deputy spokesperson' };
export const roleLabel = (r: string | null) => (r ? ROLE[r] ?? r.replace(/_/g, ' ') : 'member');

const fmtDay = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

const inPeriod = (m: AwMandate, iso: string | null): boolean => {
  const [a, b = a] = (m.period.match(/\d{4}/g) ?? []).map(Number);
  const y = iso ? Number(iso.slice(0, 4)) : NaN;
  return !!iso && a !== undefined && y >= a && y <= b;
};

// "Direct mandate, constituency 230 - Rottal-Inn (16.2 %)" · "List: Landesliste Bayern, place 1"
export function electedText(m: AwMandate): string {
  const won = m.won === 'constituency' ? 'direct mandate' : m.won === 'list' ? 'by list' : m.won === 'moved_up' ? 'moved up from the list' : '';
  const parts = [
    won,
    m.constituency ? `constituency ${m.constituency}${m.constituency_result !== null ? ` (${m.constituency_result.toLocaleString('en')} %)` : ''}` : '',
    m.list ? `${m.list}${m.list_position ? `, place ${m.list_position}` : ''}` : '',
    // Dates only when they fall in the period: some records carry the start of a first mandate years earlier.
    inPeriod(m, m.start) || inPeriod(m, m.end) ? `${inPeriod(m, m.start) ? fmtDay(m.start) : '…'}–${inPeriod(m, m.end) ? fmtDay(m.end) : '…'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ').replace(/^./, (c) => c.toUpperCase()) : '';
}

export function fractionText(m: AwMandate): string {
  return m.fractions.map((f) => `${f.label}${f.from || f.until ? ` (${fmtDay(f.from) || '…'}–${fmtDay(f.until) || '…'})` : ''}`).join(', ');
}

// Key facts as [label, value] pairs, in display order.
export function personFacts(p: PersonProfile): Array<[string, string]> {
  const a = p.abgeordnetenwatch, d = p.dip;
  const rows: Array<[string, string | null | undefined]> = [
    ['Born', a?.year_of_birth ? String(a.year_of_birth) : null],
    ['Party', a?.party],
    ['Earlier parties', a?.party_past],
    ['Education', a?.education],
    ['Occupation', a?.occupation],
    ['Residence', a?.residence],
    ['In the Bundestag (DIP)', d?.wahlperioden.length ? `Wahlperiode ${wpList(d.wahlperioden)}` : null],
    ['Latest DIP title', d?.title],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

// Offices and roles from DIP other than the Fraktion (that is in the mandates): ministries, and acting for a Land (a Land
// government member speaking in the Bundestag or Bundesrat). The same role in several records is merged.
export function dipRoles(p: PersonProfile): string[] {
  const merged = new Map<string, number[]>();
  for (const r of p.dip?.roles ?? []) {
    const label = [r.funktion, r.ressort, r.bundesland ? `Acting for the Land ${r.bundesland}` : null].filter(Boolean).join(', ');
    if (label) merged.set(label, [...(merged.get(label) ?? []), ...r.wahlperioden]);
  }
  return [...merged].map(([label, wps]) => `${label}${wps.length ? ` (Bundestag Wahlperiode ${wpList(wps)})` : ''}`);
}

// "455 activities: 435 Antwort, 12 Rede, …"
export function activityText(p: PersonProfile): string | null {
  const act = p.dip?.activities;
  if (!act || !act.total) return null;
  const kinds = Object.entries(act.kinds).map(([k, n]) => `${n.toLocaleString('en')} ${k}`).join(', ');
  return `${act.total.toLocaleString('en')} ${act.total === 1 ? 'activity' : 'activities'}${kinds ? `: ${kinds}` : ''}`;
}

export function questionsText(p: PersonProfile): string | null {
  const a = p.abgeordnetenwatch;
  if (!a || a.questions === null || a.questions === undefined) return null;
  return `${a.questions.toLocaleString('en')} questions from citizens on abgeordnetenwatch.de, ${(a.questions_answered ?? 0).toLocaleString('en')} answered`;
}

export const storyYears = (p: PersonProfile) => (p.dip?.activities ? `${p.dip.activities.from.slice(0, 4)}–${p.dip.activities.to.slice(0, 4)}` : '2012–2016');
