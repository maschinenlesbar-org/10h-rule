// API response types, shared by the server (server/queries.ts) and the browser.

export type Marker = 'primary' | 'secondary' | 'unverified';

export interface EntityRef { id: string; type: string; label: string }

export interface Evidence {
  doc_id: string | null; doc_label: string | null; file_id: string | null; page: number | null;
  locator: string | null; quote: string | null; read_via: string | null;
}

export interface Fact {
  id: string;
  pred: string;
  label: string;          // predicate label in the direction shown ("asked" or "asked by")
  direction: 'out' | 'in';
  other: EntityRef | null; // the entity on the other side, or null for a literal value
  value: string | null;
  start: string | null; end: string | null; precision: string | null;
  marker: Marker; method: string; source: string | null; rationale: string | null;
  interpretive: boolean;
  evidence: Evidence[];
}

export interface DocumentInfo {
  kind: string | null; issuer: string | null; parliament: string | null; number: string | null; wp: number | null;
  date: string | null; title: string | null; source_url: string | null; archived: boolean;
  files: Array<{ id: string; part: string | null; pages: number; bytes: number; source_url: string | null; sha256: string }>;
}

export interface ExternalId { scheme: string; value: string; status: string; url: string | null }

export interface EntityPage {
  entity: EntityRef & { props: Record<string, unknown> };
  aliases: string[];
  external: ExternalId[];
  facts: Fact[];
  document: DocumentInfo | null;
  mentionedIn: Array<{ doc: EntityRef; n: number; status: string }>;
  mentionTotal: number;
  procedure?: ProcedureView;
  rollcall?: RollCallView;
}

export interface SearchHit {
  doc: EntityRef & { kind: string | null; date: string | null; parliament: string | null; title: string | null };
  passages: Array<{ chunk_id: number; file_id: string; page_from: number; page_to: number; snippet: string; match: 'keyword' | 'semantic' | 'both' }>;
  score: number;
}

export interface Facet { value: string; n: number }

export interface SearchResult {
  query: string; fts: string; expandedWith: string[]; mode: 'hybrid' | 'keyword';
  entities: Array<EntityRef & { matched: string }>;
  hits: SearchHit[]; total: number;
  facets: { kind: Facet[]; parliament: Facet[]; year: Facet[] };
}

export interface PageSpan { start: number; end: number; entity: EntityRef; kind: 'entity' | 'ref'; status: string }

export interface PageView {
  doc: EntityRef; file_id: string; page_no: number; pages: number; read_via: string; text: string; spans: PageSpan[];
  files: Array<{ id: string; part: string | null; pages: number; bytes: number }>;
}

export interface ListRow { id: string; label: string; type: string; cols: Record<string, string | number | null> }

export interface ReviewGroup {
  entity: EntityRef; surface: string; n: number; status: string;
  samples: Array<{ doc_id: string; file_id: string; page_from: number; context: string }>;
}

export interface Meta { built_at: string; counts: Record<string, number>; markers: Record<string, number>; reviewWritable: boolean; semantic: boolean }

export interface StoryEvent { id: string; label: string; date: string; end: string | null; precision: string; arena: string; procedures: string[] }
export interface StoryProcedure { id: string; label: string; start: string; end: string | null; arena: string; status: string }
export interface StoryVote { id: string; label: string; date: string; arena: string; yes: number; no: number; abstain: number }
export interface StoryLink { from: string; to: string; fromLabel: string; toLabel: string; rationale: string; marker: Marker; evidence: Evidence[] }
export interface Story { lanes: Array<{ id: string; label: string }>; events: StoryEvent[]; procedures: StoryProcedure[]; votes: StoryVote[]; links: StoryLink[] }

export interface ProcedureStep { date: string; end: string | null; event: EntityRef | null; text: string; body: string | null; docs: EntityRef[] }
export interface ProcedureView { start: string; end: string | null; status: string; description: string; steps: ProcedureStep[]; otherDocs: EntityRef[] }

export interface RollCallGroup { group: string; yes: number; no: number; abstain: number; not_voted: number }
export interface RollCallMember { name: string; person: EntityRef | null; group: string | null; group_source: string | null; option: string; page: number | null }
export interface RollCallView {
  groups: RollCallGroup[]; deviators: Array<RollCallMember & { majority: string }>; members: RollCallMember[];
  file: string | null; pages: number[]; hasNotVoted: boolean;
}

export interface SimilarDoc { doc: EntityRef & { kind: string | null; date: string | null }; score: number }
export interface SimilarPassage { doc: EntityRef; file_id: string; page_from: number; excerpt: string; score: number }

export interface QuestionRow {
  doc: EntityRef; parliament: string | null; date: string | null; label: string | null;
  asker: EntityRef; party: string | null;
  answerer: (EntityRef & { kind: 'person' | 'ministry'; short: string }) | null;
}
export interface Observation {
  id: string; metric: string; value: number; unit: string; period_start: string | null; period_end: string | null;
  place: EntityRef | null; doc: EntityRef; file_id: string | null; page: number | null; quote: string; note: string; verified: boolean;
}
export interface LandStatus { land: EntityRef; status: string; summary: string; marker: Marker; doc: EntityRef | null; source: string }
