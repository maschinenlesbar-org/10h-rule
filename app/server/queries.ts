// Read queries for the app. Every function returns plain JSON-able objects typed in web/src/types.ts.

// Works on node:sqlite (server) and on the sqlite-wasm adapter (static export): only prepare().all/get/run are used.
export interface Db { prepare(sql: string): { all(...p: any[]): unknown[]; get(...p: any[]): unknown; run(...p: any[]): { changes: number | bigint } } }
import { Dict } from '../build/lib/dict.ts';
import { extractRefs, parliamentOf } from '../build/lib/refs.ts';
import type {
  EntityPage, EntityRef, Evidence, Fact, SearchResult, SearchHit, PageView, PageSpan, ListRow, ReviewGroup, Meta, ExternalId, Facet,
  Story, ProcedureView, RollCallView, RollCallMember, SimilarDoc, SimilarPassage, QuestionRow, Observation, LandStatus,
} from '../web/src/types.ts';
import { fromBlob } from '../build/lib/vec.ts';

const STOPWORDS = new Set(('der die das den dem des ein eine einen einem einer eines und oder aber ist sind war waren wird werden wurde wurden '
  + 'hat haben kann können soll sollen muss müssen von vom zu zum zur im in an am auf aus bei mit nach noch nicht nur auch als wie was wer welche '
  + 'welcher welches viele wieviele durch für über unter gegen ohne sich es sie er man ob dass wenn dann denn doch schon sehr mehr').split(' '));
const excerpt = (t: string) => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > 280 ? s.slice(0, s.lastIndexOf(' ', 277)) + ' …' : s; };

type Row = Record<string, any>;

export class Queries {
  private db: Db;
  private pageDict: Dict;
  reviewWritable = false;
  // Vectors for semantic search, loaded once (8,400 × 1,024 float32 ≈ 34 MB). The embedder is attached by the server.
  private vecIds: number[] = [];
  private vecs: Float32Array = new Float32Array(0);
  private vecDocs: string[] = [];
  private dim = 0;
  embedQuery: ((q: string) => Promise<Float32Array>) | null = null;

  constructor(db: Db) {
    this.db = db;
    // Same linking rules as the build: people by full name only.
    this.pageDict = new Dict(db, { types: ['Person', 'Organization', 'Place', 'Concept', 'Law'], kinds: ['label', 'alias'] });
    const rows = this.all('SELECT v.chunk_id, v.v, c.doc_id FROM chunk_vec v JOIN chunk c ON c.id = v.chunk_id ORDER BY v.chunk_id');
    if (rows.length) {
      this.dim = (rows[0].v as Uint8Array).byteLength / 4;
      this.vecs = new Float32Array(rows.length * this.dim);
      rows.forEach((r, i) => { this.vecs.set(fromBlob(r.v), i * this.dim); this.vecIds.push(r.chunk_id); this.vecDocs.push(r.doc_id); });
    }
  }

  get hasVectors(): boolean { return this.vecIds.length > 0; }

  // The text the semantic half embeds. Every document in this corpus is about 10H, so naming it in a question pulls the
  // query toward generic 10H texts: "Regierung verweigert Auskunft 10H" ranked its target 23rd, without "10H" 8th;
  // "Ist die 10H-Regel verfassungsgemäß?" 15th and 3rd. The short names (10H, 10 H, 10-H-Regelung) are dropped when at
  // least two content words remain.
  semanticQuery(query: string): string {
    const aliases = this.all("SELECT alias FROM alias WHERE entity_id = 'concept/10h' UNION SELECT label FROM entity WHERE id = 'concept/10h'")
      .map((r) => String(r.alias)).filter((a) => /^10/.test(a)).sort((a, b) => b.length - a.length); // not "zehnfache Höhe": that is content
    if (!aliases.length) return query;
    const esc = (a: string) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${aliases.map(esc).join('|')})(?![\\p{L}\\p{N}])-?`, 'giu');
    const rest = query.replace(re, ' ').replace(/\s+/g, ' ').trim();
    const content = rest.replace(/[?!.,;:()]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
    return rest !== query.trim() && content.length >= 2 ? rest : query;
  }

  private all(sql: string, ...p: any[]): Row[] { return this.db.prepare(sql).all(...p) as Row[]; }
  private get(sql: string, ...p: any[]): Row | undefined { return this.db.prepare(sql).get(...p) as Row | undefined; }

  meta(): Meta {
    const counts: Record<string, number> = {};
    for (const r of this.all('SELECT type, count(*) n FROM entity GROUP BY type')) counts[r.type] = r.n;
    for (const [k, sql] of Object.entries({
      archived: 'SELECT count(*) n FROM document WHERE archived = 1', pages: 'SELECT count(*) n FROM page',
      statements: 'SELECT count(*) n FROM statement', citations: "SELECT count(*) n FROM statement WHERE pred = 'cites'",
      review: "SELECT count(*) n FROM mention WHERE status = 'auto'",
    })) counts[k] = this.get(sql)!.n;
    const markers: Record<string, number> = {};
    for (const r of this.all("SELECT marker, count(*) n FROM statement WHERE method != 'regex' GROUP BY marker")) markers[r.marker] = r.n;
    return { built_at: this.get("SELECT value FROM meta WHERE key = 'built_at'")?.value ?? '', counts, markers,
      reviewWritable: this.reviewWritable, semantic: this.hasVectors && !!this.embedQuery };
  }

  // ---------- search ----------

  // User input → FTS5 query: quoted terms (phrases kept), optional trailing * for prefix search.
  static ftsQuery(q: string): string {
    const terms = [...q.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => (m[1] ?? m[2]).trim()).filter(Boolean);
    return terms.map((t) => {
      const prefix = t.endsWith('*');
      const clean = t.replace(/\*$/, '').replace(/"/g, '""');
      return clean ? `"${clean}"${prefix ? '*' : ''}` : '';
    }).filter(Boolean).join(' AND ');
  }

  // Hybrid search: keyword ranking (FTS5, BM25) and semantic ranking (cosine) fused by reciprocal rank fusion, then
  // grouped by document. mode "keyword" (or no vectors/model) uses the keyword ranking only.
  async search(q: string, filters: { kind?: string; parliament?: string; year?: string }, mode: 'hybrid' | 'keyword' = 'hybrid'): Promise<SearchResult> {
    const query = q.trim();
    const useSemantic = mode === 'hybrid' && this.hasVectors && !!this.embedQuery;
    const empty: SearchResult = { query, fts: '', expandedWith: [], mode: useSemantic ? 'hybrid' : 'keyword', entities: [], hits: [], total: 0, facets: { kind: [], parliament: [], year: [] } };
    if (!query) return empty;

    // Entities whose alias starts with the query, plus document references typed directly ("BT-Drs 18/1310").
    const entities = new Map<string, EntityRef & { matched: string }>();
    for (const r of extractRefs(query, null)) {
      const e = r.id ? this.get('SELECT id, type, label FROM entity WHERE id = ?', r.id) : undefined;
      if (e) entities.set(e.id, { id: e.id, type: e.type, label: e.label, matched: r.raw });
    }
    for (const r of this.all(`SELECT e.id, e.type, e.label, a.alias FROM alias a JOIN entity e ON e.id = a.entity_id
                              WHERE a.alias LIKE ? AND a.kind != 'surname' ORDER BY length(a.alias) LIMIT 12`, `${query}%`)) {
      if (!entities.has(r.id)) entities.set(r.id, { id: r.id, type: r.type, label: r.label, matched: r.alias });
    }

    // Concept aliases expand the full-text query: "10H" also finds "10 H" and "10-H-Regelung".
    let fts = Queries.ftsQuery(query);
    const expandedWith: string[] = [];
    const concept = this.get(`SELECT e.id FROM alias a JOIN entity e ON e.id = a.entity_id WHERE e.type = 'Concept' AND a.alias = ? COLLATE NOCASE`, query);
    if (concept) {
      for (const r of this.all('SELECT alias FROM alias WHERE entity_id = ? AND alias != ? COLLATE NOCASE', concept.id, query)) expandedWith.push(r.alias);
      fts = [fts, ...expandedWith.map((a) => Queries.ftsQuery(`"${a}"`))].map((x) => `(${x})`).join(' OR ');
    }

    const docFilter = (d: Row | undefined) => !!d && (!filters.kind || d.kind === filters.kind) && (!filters.parliament || d.parliament === filters.parliament)
      && (!filters.year || (d.date ?? '').slice(0, 4) === filters.year);
    const docMeta = new Map<string, Row>();
    const docOf = (id: string) => {
      if (!docMeta.has(id)) docMeta.set(id, this.get(`SELECT e.id, e.type, e.label, d.kind, d.date, d.parliament, d.title FROM entity e JOIN document d ON d.id = e.id WHERE e.id = ?`, id)!);
      return docMeta.get(id)!;
    };

    // Keyword ranking. In hybrid mode a question in plain language ("Ist die 10H-Regel verfassungsgemäß?") should not need
    // every word, so the keyword part becomes an OR over the content words and BM25 ranks by how many match.
    if (useSemantic && !/"/.test(query)) {
      const words = query.replace(/[?!.,;:()]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
      if (words.length > 1) fts = [fts && concept ? fts : '', ...words.map((w) => Queries.ftsQuery(w.endsWith('*') ? w : `${w}*`))].filter(Boolean).map((x) => `(${x})`).join(' OR ');
    }
    let lexical: Row[] = [];
    if (fts) {
      try {
        lexical = this.all(`SELECT c.id chunk_id, c.doc_id, c.file_id, c.page_from, c.page_to, bm25(chunk_fts) score,
                              snippet(chunk_fts, 0, char(2), char(3), '…', 24) snippet
                            FROM chunk_fts JOIN chunk c ON c.id = chunk_fts.rowid WHERE chunk_fts MATCH ? ORDER BY score LIMIT 800`, fts)
          .filter((r) => docFilter(docOf(r.doc_id))).slice(0, 500);
      } catch { lexical = []; }
    }
    // Semantic ranking
    let semantic: Array<{ chunk_id: number; score: number }> = [];
    if (useSemantic) {
      const qv = await this.embedQuery!(this.semanticQuery(query));
      const n = this.vecIds.length;
      const scored: Array<{ chunk_id: number; score: number; doc: string }> = [];
      for (let i = 0; i < n; i++) {
        let s = 0;
        const o = i * this.dim;
        for (let k = 0; k < this.dim; k++) s += qv[k] * this.vecs[o + k];
        scored.push({ chunk_id: this.vecIds[i], score: s, doc: this.vecDocs[i] });
      }
      scored.sort((a, b) => b.score - a.score);
      semantic = scored.filter((x) => docFilter(docOf(x.doc))).slice(0, 300);
    }

    // Reciprocal rank fusion (k = 60)
    const fused = new Map<number, { rrf: number; lex: Row | null; sem: boolean }>();
    lexical.forEach((r, i) => fused.set(r.chunk_id, { rrf: 1 / (60 + i + 1), lex: r, sem: false }));
    semantic.forEach((r, i) => {
      const f = fused.get(r.chunk_id) ?? { rrf: 0, lex: null, sem: false };
      f.rrf += 1 / (60 + i + 1);
      f.sem = true;
      fused.set(r.chunk_id, f);
    });
    if (!fused.size) return { ...empty, fts, expandedWith, entities: [...entities.values()] };
    const chunkRow = this.db.prepare('SELECT id chunk_id, doc_id, file_id, page_from, page_to, text FROM chunk WHERE id = ?');
    const ranked = [...fused].sort((a, b) => b[1].rrf - a[1].rrf);

    const byDoc = new Map<string, SearchHit>();
    for (const [chunkId, f] of ranked) {
      const c = f.lex ?? (chunkRow.get(chunkId) as Row);
      let hit = byDoc.get(c.doc_id);
      if (!hit) {
        const d = docOf(c.doc_id);
        hit = { doc: { id: d.id, type: d.type, label: d.label, kind: d.kind, date: d.date, parliament: d.parliament, title: d.title }, passages: [], score: 0 };
        byDoc.set(c.doc_id, hit);
      }
      // Document score: best passage plus half of the second best.
      hit.score += hit.passages.length === 0 ? f.rrf : hit.passages.length === 1 ? f.rrf / 2 : 0;
      if (hit.passages.length < 2) {
        const text = f.lex ? f.lex.snippet : excerpt((chunkRow.get(chunkId) as Row).text);
        hit.passages.push({ chunk_id: chunkId, file_id: c.file_id, page_from: c.page_from, page_to: c.page_to, snippet: text,
          match: f.lex && f.sem ? 'both' : f.lex ? 'keyword' : 'semantic' });
      }
    }
    const docs = [...byDoc.values()].sort((a, b) => b.score - a.score);
    const facet = (key: (d: Row) => string | null): Facet[] => {
      const m = new Map<string, number>();
      for (const h of docs) { const v = key(docOf(h.doc.id)); if (v) m.set(v, (m.get(v) ?? 0) + 1); }
      return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
    };
    return {
      query, fts, expandedWith, mode: useSemantic ? 'hybrid' : 'keyword', entities: [...entities.values()],
      hits: docs.slice(0, 40), total: docs.length,
      facets: { kind: facet((d) => d.kind), parliament: facet((d) => d.parliament), year: facet((d) => d.date?.slice(0, 4) ?? null).sort((a, b) => a.value.localeCompare(b.value)) },
    };
  }

  // "More like this": precomputed in the build, so it works without the model.
  similarDocs(docId: string): SimilarDoc[] {
    return this.all(`SELECT n.neighbor_id, n.score, e.type, e.label, d.kind, d.date FROM doc_neighbor n JOIN entity e ON e.id = n.neighbor_id
      JOIN document d ON d.id = n.neighbor_id WHERE n.doc_id = ? ORDER BY n.rank`, docId)
      .map((r) => ({ doc: { id: r.neighbor_id, type: r.type, label: r.label, kind: r.kind, date: r.date }, score: r.score }));
  }

  similarPassages(fileId: string, pageNo: number): SimilarPassage[] {
    const rows = this.all(`SELECT n.neighbor_id, max(n.score) score, c2.doc_id, c2.file_id, c2.page_from, c2.text, e.type, e.label
      FROM chunk c JOIN chunk_neighbor n ON n.chunk_id = c.id JOIN chunk c2 ON c2.id = n.neighbor_id JOIN entity e ON e.id = c2.doc_id
      WHERE c.file_id = ? AND ? BETWEEN c.page_from AND c.page_to GROUP BY n.neighbor_id ORDER BY score DESC LIMIT 30`, fileId, pageNo);
    const seen = new Set<string>();
    const out: SimilarPassage[] = [];
    for (const r of rows) {
      if (seen.has(r.doc_id)) continue; // one passage per document
      seen.add(r.doc_id);
      out.push({ doc: { id: r.doc_id, type: r.type, label: r.label }, file_id: r.file_id, page_from: r.page_from, excerpt: excerpt(r.text), score: r.score });
      if (out.length === 6) break;
    }
    return out;
  }

  // ---------- entities ----------

  entity(id: string): EntityPage | null {
    const e = this.get('SELECT id, type, label, props FROM entity WHERE id = ?', id);
    if (!e) return null;
    const preds = new Map(this.all('SELECT * FROM predicate').map((p) => [p.id, p]));
    const facts: Fact[] = [];
    const limitIn = e.type === 'Law' || e.type === 'Concept' ? 300 : 1000;
    const rows = [
      ...this.all(`SELECT s.*, 'out' dir, o.id oid, o.type otype, o.label olabel FROM statement s LEFT JOIN entity o ON o.id = s.obj WHERE s.subj = ?`, id),
      ...this.all(`SELECT s.*, 'in' dir, o.id oid, o.type otype, o.label olabel FROM statement s JOIN entity o ON o.id = s.subj WHERE s.obj = ? LIMIT ?`, id, limitIn),
    ];
    const evStmt = this.db.prepare(`SELECT ev.*, de.label doc_label FROM evidence ev LEFT JOIN entity de ON de.id = ev.doc_id WHERE ev.statement_id = ?`);
    for (const r of rows) {
      const p = preds.get(r.pred);
      facts.push({
        id: r.id, pred: r.pred, label: r.dir === 'out' ? p?.label_en ?? r.pred : p?.inverse_en ?? r.pred, direction: r.dir,
        other: r.oid ? { id: r.oid, type: r.otype, label: r.olabel } : null, value: r.value,
        start: r.start, end: r.end, precision: r.date_precision, marker: r.marker, method: r.method, source: r.source,
        rationale: r.rationale, interpretive: !!p?.interpretive,
        evidence: (evStmt.all(r.id) as Row[]).map((v) => ({ doc_id: v.doc_id, doc_label: v.doc_label, file_id: v.file_id, page: v.page,
          locator: v.locator, quote: v.quote, read_via: v.read_via })) as Evidence[],
      });
    }

    let document: EntityPage['document'] = null;
    if (e.type === 'Document') {
      const d = this.get('SELECT * FROM document WHERE id = ?', id);
      if (d) document = { kind: d.kind, issuer: d.issuer, parliament: d.parliament, number: d.number, wp: d.wp, date: d.date, title: d.title,
        source_url: d.source_url, archived: !!d.archived,
        files: this.all('SELECT id, part, pages, source_url, sha256 FROM file WHERE doc_id = ? ORDER BY id', id) as any };
    }

    const mentionedIn = this.all(`SELECT c.doc_id, de.type, de.label, count(*) n, max(m.status = 'confirmed') confirmed
      FROM mention m JOIN chunk c ON c.id = m.chunk_id JOIN entity de ON de.id = c.doc_id
      WHERE m.entity_id = ? AND m.status != 'rejected' GROUP BY c.doc_id ORDER BY n DESC LIMIT 40`, id)
      .map((r) => ({ doc: { id: r.doc_id, type: r.type, label: r.label }, n: r.n, status: r.confirmed ? 'confirmed' : 'auto' }));
    const mentionTotal = this.get("SELECT count(*) n FROM mention WHERE entity_id = ? AND status != 'rejected'", id)!.n;

    return {
      procedure: e.type === 'Procedure' ? this.procedure(id, JSON.parse(e.props)) : undefined,
      rollcall: e.type === 'VoteEvent' ? this.rollcall(id) : undefined,
      entity: { id: e.id, type: e.type, label: e.label, props: JSON.parse(e.props) },
      aliases: this.all("SELECT alias FROM alias WHERE entity_id = ? AND kind != 'label' ORDER BY alias", id).map((r) => r.alias),
      external: this.all('SELECT scheme, value, status FROM external_id WHERE entity_id = ? ORDER BY scheme', id).map((r) => ({ ...r, url: externalUrl(r.scheme, r.value) })) as ExternalId[],
      facts, document, mentionedIn, mentionTotal,
    };
  }

  // ---------- story, procedures, roll calls ----------

  story(): Story {
    const ev = this.all(`SELECT e.id, e.label, json_extract(e.props, '$.date') date, json_extract(e.props, '$.end') end,
        json_extract(e.props, '$.precision') precision, json_extract(e.props, '$.arena') arena,
        (SELECT group_concat(s.obj) FROM statement s WHERE s.subj = e.id AND s.pred = 'part_of') procs
      FROM entity e WHERE e.type = 'Event' ORDER BY date`);
    const pr = this.all(`SELECT id, label, json_extract(props, '$.start') start, json_extract(props, '$.end') end,
        json_extract(props, '$.arena') arena, json_extract(props, '$.status') status FROM entity WHERE type = 'Procedure' ORDER BY start`);
    const vo = this.all(`SELECT v.id, e.label, v.date, v.body, v.yes, v.no, v.abstain FROM vote_event v JOIN entity e ON e.id = v.id ORDER BY v.date`);
    const evStmt = this.db.prepare(`SELECT ev.*, de.label doc_label FROM evidence ev LEFT JOIN entity de ON de.id = ev.doc_id WHERE ev.statement_id = ?`);
    const links = this.all(`SELECT s.id, s.subj, s.obj, s.rationale, s.marker, a.label alabel, b.label blabel FROM statement s
        JOIN entity a ON a.id = s.subj JOIN entity b ON b.id = s.obj WHERE s.pred = 'led_to'`)
      .map((r) => ({ from: r.subj, to: r.obj, fromLabel: r.alabel, toLabel: r.blabel, rationale: r.rationale, marker: r.marker,
        evidence: evStmt.all(r.id) as any }));
    return {
      lanes: [{ id: 'by', label: 'Bayern' }, { id: 'br', label: 'Bundesrat' }, { id: 'bund-government', label: 'Bundesregierung, Bund' },
        { id: 'bt', label: 'Bundestag' }, { id: 'sn', label: 'Sachsen' }],
      events: ev.map((r) => ({ id: r.id, label: r.label, date: r.date, end: r.end, precision: r.precision, arena: r.arena, procedures: r.procs ? r.procs.split(',') : [] })),
      procedures: pr as any,
      votes: vo.map((r) => ({ id: r.id, label: r.label, date: r.date, arena: r.body === 'Bundestag' ? 'bt' : 'by', yes: r.yes, no: r.no, abstain: r.abstain })),
      links,
    };
  }

  private procedure(id: string, props: Record<string, any>): ProcedureView {
    const events = this.all(`SELECT e.id, e.type, e.label, json_extract(e.props, '$.date') date, json_extract(e.props, '$.end') end,
        json_extract(e.props, '$.text') text, json_extract(e.props, '$.body') body
      FROM statement s JOIN entity e ON e.id = s.subj WHERE s.pred = 'part_of' AND s.obj = ? AND e.type = 'Event' ORDER BY date`, id);
    const docsOf = this.db.prepare(`SELECT o.id, o.type, o.label FROM statement s JOIN entity o ON o.id = s.obj WHERE s.subj = ? AND s.pred = 'documented_in'`);
    const steps = events.map((r) => ({ date: r.date, end: r.end, event: { id: r.id, type: r.type, label: r.label }, text: r.text, body: r.body,
      docs: docsOf.all(r.id) as unknown as EntityRef[] }));
    const used = new Set(steps.flatMap((s) => s.docs.map((d) => d.id)));
    const otherDocs = this.all(`SELECT o.id, o.type, o.label FROM statement s JOIN entity o ON o.id = s.subj WHERE s.pred = 'part_of' AND s.obj = ? AND o.type = 'Document'`, id)
      .filter((d) => !used.has(d.id)) as EntityRef[];
    return { start: props.start, end: props.end, status: props.status, description: props.description, steps, otherDocs };
  }

  private rollcall(id: string): RollCallView {
    const rows = this.all(`SELECT v.name, v.person_id, p.type ptype, p.label plabel, v.group_label, v.group_source, v.option, v.file_id, v.page
      FROM vote v LEFT JOIN entity p ON p.id = v.person_id WHERE v.vote_event_id = ? ORDER BY v.group_label, v.name`, id);
    const members: RollCallMember[] = rows.map((r) => ({ name: r.name, person: r.person_id ? { id: r.person_id, type: r.ptype, label: r.plabel } : null,
      group: r.group_label, group_source: r.group_source, option: r.option, page: r.page }));
    const byGroup = new Map<string, Record<string, number>>();
    for (const m of members) {
      const g = m.group ?? 'Fraktion unknown';
      const c = byGroup.get(g) ?? { yes: 0, no: 0, abstain: 0, not_voted: 0 };
      c[m.option]++;
      byGroup.set(g, c);
    }
    const groups = [...byGroup].map(([group, c]) => ({ group, yes: c.yes, no: c.no, abstain: c.abstain, not_voted: c.not_voted }))
      .sort((a, b) => (a.group === 'Fraktion unknown' ? 1 : b.group === 'Fraktion unknown' ? -1 : (b.yes + b.no + b.abstain + b.not_voted) - (a.yes + a.no + a.abstain + a.not_voted)));
    // Deviators: voted, but not with the majority of their Fraktion among those who voted.
    const majority = new Map(groups.map((g) => {
      const opts = [['yes', g.yes], ['no', g.no], ['abstain', g.abstain]] as Array<[string, number]>;
      return [g.group, opts.sort((a, b) => b[1] - a[1])[0][0]];
    }));
    const deviators = members.filter((m) => m.group && m.option !== 'not_voted' && m.option !== majority.get(m.group))
      .map((m) => ({ ...m, majority: majority.get(m.group!)! }));
    return { groups, deviators, members, file: rows[0]?.file_id ?? null, pages: [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b),
      hasNotVoted: members.some((m) => m.option === 'not_voted') };
  }

  // ---------- questions, effects, Länder (phase 4) ----------

  // One row per asker and question. The answerer is the person who answered that question (matched by its number,
  // e.g. "SF 94", where the Drucksache collects several), else the ministry the answer was given for.
  questions(): QuestionRow[] {
    const asked = this.all(`SELECT s.subj, s.obj, s.value, s.start, p.label plabel, d.parliament, d.date, de.label dlabel,
        (SELECT o.label FROM statement m JOIN entity o ON o.id = m.obj WHERE m.subj = s.subj AND m.pred = 'member_of'
           AND json_extract(o.props, '$.classification') IN ('party', 'parliamentary_group') ORDER BY json_extract(o.props, '$.classification') = 'party' DESC LIMIT 1) party
      FROM statement s JOIN entity p ON p.id = s.subj JOIN document d ON d.id = s.obj JOIN entity de ON de.id = s.obj
      WHERE s.pred = 'asked' ORDER BY coalesce(s.start, d.date)`);
    const answeredBy = this.db.prepare(`SELECT s.subj, s.value, e.type, e.label FROM statement s JOIN entity e ON e.id = s.subj WHERE s.pred = 'answered'
      AND (s.obj = ? OR s.obj IN (SELECT a.subj FROM statement a WHERE a.pred = 'responds_to' AND a.obj = ?))`);
    // An AzP compilation has one answering ministry per asker (value = asker); other answers have one for the document.
    const answeredFor = this.db.prepare(`SELECT s.obj, e.type, e.label FROM statement s JOIN entity e ON e.id = s.obj WHERE s.pred = 'answered_for'
      AND (s.subj = ? OR s.subj IN (SELECT a.subj FROM statement a WHERE a.pred = 'responds_to' AND a.obj = ?)) AND (s.value IS NULL OR s.value = ?)
      ORDER BY s.value IS NULL LIMIT 1`);
    return asked.map((r) => {
      const persons = answeredBy.all(r.obj, r.obj) as Row[];
      const person = persons.find((x) => r.value && x.value === r.value) ?? (persons.length === 1 || !r.value ? persons[0] : undefined);
      const org = person ? undefined : answeredFor.get(r.obj, r.obj, r.subj) as Row | undefined;
      return {
        doc: { id: r.obj, type: 'Document', label: r.dlabel }, parliament: r.parliament, date: r.start ?? r.date, label: r.value,
        asker: { id: r.subj, type: 'Person', label: r.plabel }, party: r.party,
        answerer: person ? { id: person.subj, type: person.type, label: person.label, kind: 'person', short: person.label }
          : org ? { id: org.obj, type: org.type, label: org.label, kind: 'ministry', short: this.shortName(org.obj, org.label) } : null,
      };
    });
  }

  // Shortest abbreviation-like alias ("StMWi", "BMUB"), else the label.
  private shortName(id: string, label: string): string {
    const a = this.get(`SELECT alias FROM alias WHERE entity_id = ? AND length(alias) BETWEEN 2 AND 8 AND alias GLOB '[A-Z]*' ORDER BY length(alias) LIMIT 1`, id);
    return a?.alias ?? label;
  }

  observations(): Observation[] {
    return this.all(`SELECT o.*, pe.type ptype, pe.label plabel, de.label dlabel FROM observation o LEFT JOIN entity pe ON pe.id = o.place_id
      LEFT JOIN entity de ON de.id = o.doc_id ORDER BY o.metric, o.period_start`)
      .map((r) => ({ id: r.id, metric: r.metric, value: r.value, unit: r.unit, period_start: r.period_start, period_end: r.period_end,
        place: r.place_id ? { id: r.place_id, type: r.ptype, label: r.plabel } : null, doc: { id: r.doc_id, type: 'Document', label: r.dlabel ?? r.doc_id },
        file_id: r.file_id, page: r.page, quote: r.quote, note: r.note, verified: !!r.verified }));
  }

  laender(): LandStatus[] {
    return this.all(`SELECT l.*, e.label, de.label dlabel FROM land_status l JOIN entity e ON e.id = l.land_id LEFT JOIN entity de ON de.id = l.doc_id ORDER BY e.label`)
      .map((r) => ({ land: { id: r.land_id, type: 'Place', label: r.label }, status: r.status, summary: r.summary, marker: r.marker,
        doc: r.doc_id ? { id: r.doc_id, type: 'Document', label: r.dlabel ?? r.doc_id } : null, source: r.source }));
  }

  // ---------- document reader ----------

  page(fileId: string, pageNo: number): PageView | null {
    const p = this.get(`SELECT p.text, p.read_via, f.doc_id, f.pages FROM page p JOIN file f ON f.id = p.file_id WHERE p.file_id = ? AND p.page_no = ?`, fileId, pageNo);
    if (!p) return null;
    const doc = this.get('SELECT id, type, label FROM entity WHERE id = ?', p.doc_id) as EntityRef;
    const spans: PageSpan[] = [];
    const reviewed = new Map(this.all("SELECT entity_id || '|' || surface k, status FROM mention WHERE status != 'auto' GROUP BY 1").map((r) => [r.k, r.status]));
    for (const h of this.pageDict.match(p.text).hits) {
      const status = h.type === 'Person' || h.type === 'Law' ? 'confirmed' : reviewed.get(`${h.entityId}|${h.surface.replace(/\s+/g, ' ')}`) ?? 'auto';
      if (status === 'rejected') continue;
      const ent = this.get('SELECT id, type, label FROM entity WHERE id = ?', h.entityId) as EntityRef;
      spans.push({ start: h.start, end: h.end, entity: ent, kind: 'entity', status });
    }
    for (const r of extractRefs(p.text, parliamentOf(p.doc_id), { keepOffsets: true })) {
      if (!r.id || r.id === p.doc_id) continue;
      const ent = this.get('SELECT id, type, label FROM entity WHERE id = ?', r.id) as EntityRef | undefined;
      if (ent) spans.push({ start: r.index, end: r.index + r.raw.length, entity: ent, kind: 'ref', status: 'confirmed' });
    }
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const nonOverlapping: PageSpan[] = [];
    for (const s of spans) if (!nonOverlapping.length || s.start >= nonOverlapping.at(-1)!.end) nonOverlapping.push(s);
    return {
      doc, file_id: fileId, page_no: pageNo, pages: p.pages, read_via: p.read_via, text: p.text, spans: nonOverlapping,
      files: this.all('SELECT id, part, pages FROM file WHERE doc_id = ? ORDER BY id', p.doc_id) as any,
    };
  }

  fileExists(fileId: string): boolean { return !!this.get('SELECT 1 FROM file WHERE id = ?', fileId); }

  // ---------- lists ----------

  list(kind: string): ListRow[] {
    if (kind === 'people') {
      return this.all(`SELECT e.id, e.label, e.type,
          (SELECT group_concat(o.label, ', ') FROM statement s JOIN entity o ON o.id = s.obj WHERE s.subj = e.id AND s.pred = 'member_of') party,
          (SELECT count(*) FROM statement s WHERE s.subj = e.id AND s.pred = 'asked') asked,
          (SELECT count(*) FROM statement s WHERE s.subj = e.id AND s.pred = 'answered') answered,
          (SELECT count(*) FROM statement s WHERE s.subj = e.id AND s.pred IN ('spoke_in','authored','signed')) spoke,
          (SELECT count(*) FROM mention m WHERE m.entity_id = e.id) mentions,
          json_extract(e.props, '$.profile') IS NOT NULL profile
        FROM entity e WHERE e.type = 'Person' ORDER BY e.label`)
        .map((r) => ({ id: r.id, label: r.label, type: r.type, cols: { party: r.party, asked: r.asked, answered: r.answered, spoke: r.spoke, mentions: r.mentions, profile: r.profile } }));
    }
    if (kind === 'documents') {
      return this.all(`SELECT e.id, e.label, e.type, d.kind, d.parliament, d.date, d.title, d.archived,
          (SELECT count(*) FROM statement s WHERE s.obj = e.id AND s.pred = 'cites') cited_by
        FROM entity e JOIN document d ON d.id = e.id ORDER BY d.archived DESC, d.date, e.label`)
        .map((r) => ({ id: r.id, label: r.label, type: r.type, cols: { kind: r.kind, parliament: r.parliament, date: r.date, title: r.title, archived: r.archived, cited_by: r.cited_by } }));
    }
    if (kind === 'events') {
      return this.all(`SELECT id, label, type, json_extract(props, '$.date') date, json_extract(props, '$.arena') arena,
          json_extract(props, '$.text') text FROM entity WHERE type = 'Event' ORDER BY date`)
        .map((r) => ({ id: r.id, label: r.label, type: r.type, cols: { date: r.date, arena: r.arena, text: r.text } }));
    }
    const type = { organizations: 'Organization', places: 'Place', concepts: 'Concept', laws: 'Law' }[kind];
    if (!type) return [];
    return this.all(`SELECT e.id, e.label, e.type, (SELECT count(*) FROM mention m WHERE m.entity_id = e.id AND m.status != 'rejected') mentions,
        json_extract(e.props, '$.classification') classification
      FROM entity e WHERE e.type = ? ORDER BY mentions DESC, e.label`, type)
      .map((r) => ({ id: r.id, label: r.label, type: r.type, cols: { classification: r.classification, mentions: r.mentions } }));
  }

  // ---------- review ----------

  review(type: string, status: string): ReviewGroup[] {
    const groups = this.all(`SELECT m.entity_id, e.type, e.label, m.surface, count(*) n, m.status FROM mention m JOIN entity e ON e.id = m.entity_id
      WHERE m.status = ? AND (? = '' OR e.type = ?) AND m.method = 'dictionary' GROUP BY m.entity_id, m.surface ORDER BY n DESC LIMIT 150`, status, type, type);
    const sample = this.db.prepare(`SELECT c.doc_id, c.file_id, c.page_from, c.text, m.start, m.end FROM mention m JOIN chunk c ON c.id = m.chunk_id
      WHERE m.entity_id = ? AND m.surface = ? LIMIT 3`);
    return groups.map((g) => ({
      entity: { id: g.entity_id, type: g.type, label: g.label }, surface: g.surface, n: g.n, status: g.status,
      samples: (sample.all(g.entity_id, g.surface) as Row[]).map((s) => ({
        doc_id: s.doc_id, file_id: s.file_id, page_from: s.page_from,
        context: `${s.text.slice(Math.max(0, s.start - 90), s.start)}\u0002${s.text.slice(s.start, s.end)}\u0003${s.text.slice(s.end, s.end + 90)}`.replace(/\s+/g, ' '),
      })),
    }));
  }

  setReview(entityId: string, surface: string, status: string): number {
    return Number(this.db.prepare('UPDATE mention SET status = ? WHERE entity_id = ? AND surface = ?').run(status, entityId, surface).changes);
  }
}

export function externalUrl(scheme: string, value: string): string | null {
  if (scheme === 'wikidata') return `https://www.wikidata.org/wiki/${value}`;
  if (scheme === 'abgeordnetenwatch') return `https://www.abgeordnetenwatch.de/api/v2/politicians/${value}`;
  return null;
}
