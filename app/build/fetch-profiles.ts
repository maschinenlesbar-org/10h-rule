// Fetches person data from abgeordnetenwatch.de (API v2, CC0) and the Bundestag's DIP API into data/profiles.json, the
// snapshot the (offline) build reads. Network only here: node build/fetch-profiles.ts
//
// Needs the DIP API key in DIP_API_KEY (the public key: `DIP_API_KEY=$(dip obtain-key | tail -1) node build/fetch-profiles.ts`).
// The key is never written to a file. Ids come from out/10h.db (external_id, read from the wiki profiles), so build first.
//
// Per person with an abgeordnetenwatch id: the politician record, every candidacy and mandate (current_on=all, else
// earlier mandates are missing), and the committee memberships of mandates in parliament periods that overlap the story
// (2012–2016). Per person with a DIP id: the person record and the number of activities 2012–2016 by kind.

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, DATA, OUT } from './lib/ctx.ts';

const AW = 'https://www.abgeordnetenwatch.de/api/v2';
const DIP = 'https://search.dip.bundestag.de/api/v1';
const STORY = [2012, 2016];
const PAUSE_MS = 700; // abgeordnetenwatch answers 429 to bursts
const MAX_PAGES = 40; // 100 activities per page; the most active person in the snapshot has 1,677
// Raw responses are cached, so an interrupted run resumes without asking again. Delete the folder to refetch.
const RAW = join(CACHE, 'profiles');
mkdirSync(RAW, { recursive: true });
const UA = '10h-explorer (research; https://github.com/maschinenlesbar-org/10h-rule)';

const key = process.env.DIP_API_KEY;
if (!key) { console.error('DIP_API_KEY is not set (see the header of this file).'); process.exit(1); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const cached = join(RAW, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));
  for (let attempt = 0; ; attempt++) {
    await sleep(PAUSE_MS);
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    if (res.ok) { const j = await res.json(); writeFileSync(cached, JSON.stringify(j)); return j; }
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await sleep(2000 * (attempt + 1)); continue; }
    throw new Error(`${res.status} for ${url.replace(/apikey=[^&]+/, 'apikey=…')}`);
  }
}
const aw = async (path: string) => (await getJson(`${AW}/${path}`)).data;
const dip = (path: string) => getJson(`${DIP}/${path}`, { Authorization: `ApiKey ${key}` });

const years = (label: string) => (label.match(/\d{4}/g) ?? []).map(Number);
const overlapsStory = (label: string) => { const [a, b = a] = years(label); return a !== undefined && a <= STORY[1] && b >= STORY[0]; };

async function abgeordnetenwatch(id: string) {
  const p = await aw(`politicians/${id}`);
  const all = await aw(`candidacies-mandates?politician=${id}&current_on=all&range_end=100`) as any[];
  const mandates = [];
  for (const m of all.filter((x) => x.type === 'mandate')) {
    const period = m.parliament_period?.label ?? '';
    const ed = m.electoral_data ?? {};
    const committees = overlapsStory(period)
      ? (await aw(`committee-memberships?candidacy_mandate=${m.id}&range_end=100`) as any[]).map((c) => ({
          committee: c.committee?.label?.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, '') ?? '', role: c.committee_role ?? null }))
      : null; // not fetched outside the story period
    mandates.push({
      period, start: m.start_date ?? null, end: m.end_date ?? null,
      fractions: (m.fraction_membership ?? []).map((f: any) => ({ label: f.label, from: f.valid_from ?? null, until: f.valid_until ?? null })),
      won: ed.mandate_won ?? null,
      constituency: ed.constituency?.label?.replace(/\s*\([^)]*\)$/, '') ?? null, constituency_result: ed.constituency_result ?? null,
      list: ed.electoral_list?.label?.replace(/\s*\([^)]*\)$/, '') ?? null, list_position: ed.list_position ?? null,
      committees,
    });
  }
  mandates.sort((a, b) => (years(b.period)[0] ?? 0) - (years(a.period)[0] ?? 0) || a.period.localeCompare(b.period));
  return {
    id, url: p.abgeordnetenwatch_url ?? null, name: p.label, year_of_birth: p.year_of_birth ?? null, sex: p.sex ?? null,
    party: p.party?.label ?? null, party_past: p.party_past ?? null, education: p.education ?? null, occupation: p.occupation ?? null,
    residence: p.residence ?? null, questions: p.statistic_questions ?? null, questions_answered: p.statistic_questions_answered ?? null,
    mandates,
  };
}

async function dipPerson(id: string) {
  const p = await dip(`person/${id}`);
  // Every activity 2012–2016, counted by kind (DIP has no filter by kind). At most MAX_PAGES pages; the rest is "other".
  const base = `aktivitaet?f.person_id=${id}&f.datum.start=${STORY[0]}-01-01&f.datum.end=${STORY[1]}-12-31`;
  const kinds: Record<string, number> = {};
  let total = 0, seen = 0, cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await dip(`${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    total = res.numFound;
    for (const a of res.documents ?? []) { kinds[a.aktivitaetsart] = (kinds[a.aktivitaetsart] ?? 0) + 1; seen++; }
    if (seen >= total || !res.documents?.length || res.cursor === cursor) break;
    cursor = res.cursor;
  }
  if (total > seen) kinds.other = total - seen;
  return {
    id, title: p.titel ?? null, functions: p.funktion ?? [], ministries: p.ressort ?? [], wahlperioden: p.wahlperiode ?? [],
    roles: (p.person_roles ?? []).map((r: any) => ({
      fraktion: r.fraktion ?? null, funktion: r.funktion ?? null, ressort: r.ressort_titel ?? null, bundesland: r.bundesland ?? null,
      wahlperioden: r.wahlperiode_nummer ?? [] })),
    first: p.basisdatum ?? null, last: p.datum ?? null,
    activities: { from: `${STORY[0]}-01-01`, to: `${STORY[1]}-12-31`, total, kinds: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1])) },
  };
}

const db = new DatabaseSync(join(OUT, '10h.db'), { readOnly: true });
const ids = db.prepare(`SELECT e.id, group_concat(CASE WHEN x.scheme = 'abgeordnetenwatch' THEN x.value END) aw, group_concat(CASE WHEN x.scheme = 'dip_person' THEN x.value END) dip
  FROM entity e JOIN external_id x ON x.entity_id = e.id WHERE e.type = 'Person' AND x.scheme IN ('abgeordnetenwatch', 'dip_person') GROUP BY e.id ORDER BY e.id`).all() as Array<{ id: string; aw: string | null; dip: string | null }>;

const people: Record<string, unknown> = {};
for (const [i, r] of ids.entries()) {
  console.log(`[${i + 1}/${ids.length}] ${r.id}`);
  people[r.id] = { abgeordnetenwatch: r.aw ? await abgeordnetenwatch(r.aw) : null, dip: r.dip ? await dipPerson(r.dip) : null };
}
const out = {
  fetched: new Date().toLocaleDateString('sv-SE'), // local date, YYYY-MM-DD
  sources: { abgeordnetenwatch: 'https://www.abgeordnetenwatch.de/api (CC0 1.0)', dip: 'https://search.dip.bundestag.de/api/v1 (Deutscher Bundestag)' },
  story_period: STORY,
  people,
};
writeFileSync(join(DATA, 'profiles.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`data/profiles.json: ${ids.length} people`);
