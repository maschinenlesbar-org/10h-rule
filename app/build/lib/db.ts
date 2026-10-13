import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';

export const SCHEMA = `
CREATE TABLE entity (
  id     TEXT PRIMARY KEY,
  type   TEXT NOT NULL,             -- Person | Organization | Document | Law | Event | Concept | Place | VoteEvent
  label  TEXT NOT NULL,
  props  TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE alias       (entity_id TEXT NOT NULL, alias TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (entity_id, alias));
CREATE TABLE external_id (entity_id TEXT NOT NULL, scheme TEXT NOT NULL, value TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
                          method TEXT, PRIMARY KEY (entity_id, scheme, value));
CREATE TABLE predicate   (id TEXT PRIMARY KEY, label_de TEXT, label_en TEXT, inverse_en TEXT, domain TEXT, range TEXT,
                          interpretive INTEGER NOT NULL DEFAULT 0, description TEXT);
CREATE TABLE statement (
  id TEXT PRIMARY KEY,
  subj TEXT NOT NULL, pred TEXT NOT NULL REFERENCES predicate(id), obj TEXT, value TEXT,
  start TEXT, end TEXT, date_precision TEXT,
  marker TEXT NOT NULL CHECK (marker IN ('primary','secondary','unverified')),
  method TEXT NOT NULL,              -- wiki | regex | dictionary | seed | wikidata
  source TEXT,                       -- wiki page and line, or file and page, the statement was read from
  rationale TEXT, supersedes TEXT
);
CREATE TABLE evidence (statement_id TEXT NOT NULL, doc_id TEXT, file_id TEXT, page INTEGER, locator TEXT, quote TEXT, read_via TEXT);

CREATE TABLE document (
  id TEXT PRIMARY KEY REFERENCES entity(id),
  kind TEXT, issuer TEXT, parliament TEXT, number TEXT, wp INTEGER, date TEXT, title TEXT, source_url TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE file (
  id TEXT PRIMARY KEY,               -- path relative to 10h-wiki/
  doc_id TEXT NOT NULL REFERENCES document(id),
  part TEXT, source_url TEXT, bytes INTEGER, sha256 TEXT, pages INTEGER
);
CREATE TABLE page  (file_id TEXT NOT NULL, page_no INTEGER NOT NULL, text TEXT NOT NULL, read_via TEXT NOT NULL,
                    PRIMARY KEY (file_id, page_no));
CREATE TABLE chunk (id INTEGER PRIMARY KEY, file_id TEXT NOT NULL, doc_id TEXT NOT NULL, page_from INTEGER, page_to INTEGER, text TEXT NOT NULL);
CREATE VIRTUAL TABLE chunk_fts USING fts5(text, content='chunk', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE mention (chunk_id INTEGER NOT NULL, entity_id TEXT NOT NULL, start INTEGER, end INTEGER, surface TEXT,
                      method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'auto' CHECK (status IN ('auto','confirmed','rejected')));

CREATE TABLE chunk_vec (chunk_id INTEGER PRIMARY KEY, v BLOB NOT NULL);          -- float32, L2-normalised
CREATE TABLE chunk_neighbor (chunk_id INTEGER NOT NULL, neighbor_id INTEGER NOT NULL, score REAL NOT NULL, rank INTEGER NOT NULL);
CREATE TABLE doc_neighbor (doc_id TEXT NOT NULL, neighbor_id TEXT NOT NULL, score REAL NOT NULL, rank INTEGER NOT NULL);
CREATE INDEX chunk_neighbor_chunk ON chunk_neighbor(chunk_id);
CREATE INDEX doc_neighbor_doc ON doc_neighbor(doc_id);

CREATE TABLE vote_event (id TEXT PRIMARY KEY REFERENCES entity(id), date TEXT, body TEXT, motion TEXT,
                         yes INTEGER, no INTEGER, abstain INTEGER, source_doc TEXT, locator TEXT);

CREATE TABLE vote (vote_event_id TEXT NOT NULL REFERENCES vote_event(id), name TEXT NOT NULL, person_id TEXT,
                   group_label TEXT, group_source TEXT, option TEXT NOT NULL CHECK (option IN ('yes','no','abstain','not_voted')),
                   file_id TEXT, page INTEGER);
CREATE INDEX vote_by_event ON vote(vote_event_id);
CREATE INDEX vote_person ON vote(person_id);

CREATE TABLE observation (id TEXT PRIMARY KEY, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT, period_start TEXT, period_end TEXT,
                          place_id TEXT, doc_id TEXT, file_id TEXT, page INTEGER, quote TEXT, note TEXT, verified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE land_status (land_id TEXT PRIMARY KEY, status TEXT NOT NULL, summary TEXT, marker TEXT, doc_id TEXT, source TEXT);

-- Bibliography: works outside the archive cited in the full text (build/steps/bibliography.ts). Parliamentary
-- documents are entities already (entity_id); court decisions, legislation, literature and web sources are not.
CREATE TABLE work (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('parliamentary','court','legislation','literature','web')),
                   label TEXT NOT NULL, entity_id TEXT, url TEXT, props TEXT NOT NULL DEFAULT '{}');
CREATE TABLE work_citation (work_id TEXT NOT NULL REFERENCES work(id), doc_id TEXT NOT NULL, file_id TEXT NOT NULL, page INTEGER NOT NULL,
                            quote TEXT, on_topic INTEGER NOT NULL);
CREATE INDEX work_citation_work ON work_citation(work_id);
CREATE INDEX work_citation_doc  ON work_citation(doc_id);

-- Person data from abgeordnetenwatch.de and DIP (data/profiles.json, fetched by build/fetch-profiles.ts), as JSON.
CREATE TABLE person_profile (entity_id TEXT PRIMARY KEY REFERENCES entity(id), data TEXT NOT NULL);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX statement_subj ON statement(subj);
CREATE INDEX statement_obj  ON statement(obj);
CREATE INDEX statement_pred ON statement(pred);
CREATE INDEX mention_entity ON mention(entity_id);
CREATE INDEX alias_alias    ON alias(alias);
CREATE INDEX file_doc       ON file(doc_id);
`;

export function openFresh(path: string): DatabaseSync {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Insert helpers that ignore duplicates; entity rows are merged (first label wins, props are merged).
export function upsertEntity(db: DatabaseSync, id: string, type: string, label: string, props: Record<string, unknown> = {}): void {
  const row = db.prepare('SELECT type, props FROM entity WHERE id = ?').get(id) as { type: string; props: string } | undefined;
  if (!row) {
    db.prepare('INSERT INTO entity (id, type, label, props) VALUES (?, ?, ?, ?)').run(id, type, label, JSON.stringify(props));
    return;
  }
  if (row.type !== type) throw new Error(`entity ${id}: type ${row.type} vs ${type}`);
  const merged = { ...JSON.parse(row.props), ...props };
  db.prepare('UPDATE entity SET props = ? WHERE id = ?').run(JSON.stringify(merged), id);
}

export function addAlias(db: DatabaseSync, entityId: string, alias: string, kind: string): void {
  db.prepare('INSERT OR IGNORE INTO alias (entity_id, alias, kind) VALUES (?, ?, ?)').run(entityId, alias, kind);
}

let stmtSeq = 0;
export interface StatementInput {
  subj: string; pred: string; obj?: string | null; value?: string | null;
  start?: string | null; end?: string | null; precision?: string | null;
  marker: string; method: string; source?: string | null; rationale?: string | null;
}
export function addStatement(db: DatabaseSync, s: StatementInput): string {
  const id = `s${++stmtSeq}`;
  db.prepare(`INSERT INTO statement (id, subj, pred, obj, value, start, end, date_precision, marker, method, source, rationale)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.subj, s.pred, s.obj ?? null, s.value ?? null, s.start ?? null, s.end ?? null, s.precision ?? null,
      s.marker, s.method, s.source ?? null, s.rationale ?? null);
  return id;
}

export function addEvidence(db: DatabaseSync, statementId: string, e: { doc?: string | null; file?: string | null; page?: number | null;
  locator?: string | null; quote?: string | null; readVia?: string | null }): void {
  db.prepare('INSERT INTO evidence (statement_id, doc_id, file_id, page, locator, quote, read_via) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(statementId, e.doc ?? null, e.file ?? null, e.page ?? null, e.locator ?? null, e.quote ?? null, e.readVia ?? null);
}
