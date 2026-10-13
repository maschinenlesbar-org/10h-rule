# 10H Explorer: concept

A web app that turns the 10H research into a linked, searchable record: what happened, who acted, which document
proves it, and how the pieces connect. SQLite holds the data, the front end is plain TypeScript without a UI framework,
and it runs as a static site (GitHub Pages) or with a local server. Semantic search is available only with the
local server.

Status: phases 1–6 built (database and pipeline; read-only app; story timeline, procedures, roll calls; questions, effects, Länder; local semantic search; static export and JSON-LD). Lighthouse was run on 13.10.2026 (see README.md, Static site). The bibliography of works cited from outside the archive (build step 5b, `#/bibliography`) was added on 13.10.2026. See [README.md](README.md). Decisions of 12.10.2026 are in section 10.

## 1. What the app is for

The wiki tells the story in prose and tables. The app should answer questions the prose cannot answer quickly:

- **Path.** How did a Bavarian review order in March 2013 become § 249 Abs. 3 BauGB and then Art. 82 BayBO? Which
  document led to which?
- **People.** Who asked, who answered, who voted how, and in which office at the time?
- **Evidence.** For any statement: which page of which primary document backs it, and how sure are we (primary,
  secondary, unverified)?
- **Search.** "Where does the government refuse to answer on 10H?" should find 5/14898 and the SMI statement on 6/466
  even though neither uses the word "verweigern".
- **Effect.** What happened to wind approvals in Bayern after 21.11.2014, according to the government's own answers?

Non-goals: no editing in the browser, no accounts, no generative model at run time. One exception: in review mode,
the local server records review decisions on entity mentions (`data/mention-review.csv`).

## 2. The corpus (measured 12.10.2026)

| Item | Size |
| --- | --- |
| PDFs | 141 (82 in `anfragen/`, 59 in `pdfs/`) |
| Pages | 3,317 |
| Extracted text | about 9.5 million characters |
| Image scans without text layer | 16 (Saxon WP 5, 6/466); need OCR with German traineddata |
| Wiki pages | 16 topic pages, 81 person profiles |
| Distinct document references in the wiki | about 85 |
| Timeline rows | 27 in `timeline.md`, more in `sachsen.md`, `bayern-10h.md` and `bund-2014.md` |

At about 1,500 characters per chunk this gives about 6,500 chunks. With 384-dimensional float32 vectors, the vector
table is about 10 MB. Brute-force cosine search over 6,500 vectors takes milliseconds in the browser. No vector index is
needed.

## 3. Principles

1. **Every fact has evidence.** A fact without a source document and locator (page, Anlage, line) is not loaded, or it
   is loaded with the marker `unverified` and shown as such.
2. **Deterministic build.** Parsing, entity linking and reference extraction are rules and dictionaries, tested
   against golden files. A language model may *propose* links in a separate step. Its output enters the database only as
   `unverified` until a human confirms it. (This is the same split as openka: the factory may use models, the line may
   not.)
3. **Standard vocabularies where they fit.** Use Popolo for parliaments, people, memberships and votes; PROV-O ideas for
   evidence; ELI-style identifiers for legislation; and Wikidata for `sameAs` links. Custom terms only where these have
   nothing.
4. **Time is part of every relation.** Offices, memberships and party affiliations carry `start` and `end`. "Huber,
   Umweltminister" is true from 10.10.2013 to 09/2014, not in general.
5. **The wiki stays readable.** The app reads the repository and does not replace the wiki.

## 4. Semantic schema

### 4.1 Entity types

| Type | Examples | Standard |
| --- | --- | --- |
| `Person` | Horst Seehofer, Katherina Reiche, Jana Pinka | Popolo Person, schema.org Person |
| `Organization` | CSU-Fraktion, Bayerischer Landtag, BMUB, Umweltausschuss SN, Gegenwind Unterfranken | Popolo Organization; `classification`: party, parliamentary_group, parliament, committee, ministry, government, court, association, citizens_initiative |
| `Post` | Staatsminister für Umwelt und Verbraucherschutz (BY), Parl. Staatssekretär BMUB | Popolo Post |
| `Document` | BT-Drs 18/1310, PlPr 18/44, BayVerfGH Vf. 14-VII-14, WD 3-120/14 | schema.org CreativeWork; ELI for laws |
| `Procedure` | DIP Vorgang 59400, BY law 17/2137, BR-Drs 569/13, SN Antrag 6/466 | DIP Vorgang |
| `Question` | SF 94 (Tackmann), BY SA 17/9570, SN KA 5/14898 | custom, subtype of Document |
| `Law` | § 249 Abs. 3 BauGB, Art. 82 BayBO, § 35 Abs. 1 Nr. 5 BauGB | ELI |
| `Event` | 05.03.2013 meeting, 27.06.2014 Bundestag vote, 31.12.2015 deadline | Popolo Event |
| `VoteEvent`, `Vote` | Bundestag 27.06.2014, 465 : 114 : 3, with one vote per member | Popolo VoteEvent and Vote |
| `Concept` | 10H, Länderöffnungsklausel, Vertrauensschutz, Konzentrationsfläche, Kernbereich exekutiver Eigenverantwortung | SKOS Concept |
| `Place` | Bayern, Sachsen, Regierungsbezirk Unterfranken, Planungsregion Main-Rhön | Wikidata |
| `Observation` | "Applications for turbines in Bayern, 2014: 215" | simplified RDF Data Cube |

### 4.2 Relations (controlled vocabulary)

Each relation is a row in `statement` with subject, predicate, object, a time span, evidence and a marker. The
predicates live in a `predicate` table with domain, range, a German and an English label, and the inverse label, so the
UI can show both directions ("asked" and "asked by") from one row.

| Predicate | Domain → range | Example |
| --- | --- | --- |
| `member_of` | Person → Organization | Stümpfig → GRÜNE-Fraktion BY, 2013–2018 |
| `holds_post` | Person → Post | Huber → StMUV minister, 10.10.2013–09/2014 |
| `asked` / `answered` | Person → Question | Pinka asked 5/14898; Martens answered it |
| `answered_for` | Question → Organization | 5/14898 answered for the SMJus |
| `authored` / `signed` | Person or Organization → Document | Gysi signed BT-Drs 18/1903 |
| `spoke_in` | Person → Event | Krischer spoke in the debate of 27.06.2014, PlPr 18/44 p. 3936 D |
| `voted` | Vote (Person, option) → VoteEvent | Bülow: yes on 18/1903 |
| `part_of` | Document → Procedure | BT-Drs 18/1580 is part of Vorgang 59400 |
| `responds_to` | Document → Document | Gegenäußerung → BR-Stellungnahme; answer → question |
| `cites` | Document → Document or Law | 6/466 cites 5/14898 |
| `enacts` / `amends` | Document → Law | BGBl I 2014, 954 enacts § 249 Abs. 3 BauGB |
| `implements` | Law → Law | Art. 82 BayBO implements § 249 Abs. 3 BauGB |
| `about` | Document → Concept or Place | 5/14687 is about 10H and Sachsen |
| `led_to` | Event or Document → Event or Document | Review order 05.03.2013 led to BR-Drs 569/13 (an interpretive link, so it always has a written rationale) |
| `same_as` | any → external id | Seehofer → Wikidata QID, abgeordnetenwatch 118761, DIP person 6988 |

Edges marked `led_to` are the research thesis made explicit. They get their own colour in every view, so readers can
tell documented links (`cites`, `responds_to`) from interpretive ones.

### 4.3 Evidence and markers

```text
evidence: doc + locator (page, column letter, Anlage, line) + verbatim quote + read_via (text_layer | ocr | secondary)
marker:   primary | secondary | unverified
```

A statement can have several pieces of evidence. The marker shown is the strongest one. Corrections are kept as
statements that `supersede` older ones. The 04.02. vs. 05.02.2014 correction is then visible and explainable in the
app, not silently overwritten.

### 4.4 SQLite tables

```sql
CREATE TABLE entity (
  id      TEXT PRIMARY KEY,      -- stable, readable: person/horst-seehofer, doc/bt-drs-18-1310, law/baugb-249-3
  type    TEXT NOT NULL,         -- Person | Organization | Post | Document | Procedure | Question | Law | Event | Concept | Place
  label   TEXT NOT NULL,
  props   TEXT NOT NULL DEFAULT '{}'  -- JSON: classification, party colour, dates, Drs number, wp, issuer …
);
CREATE TABLE alias       (entity_id TEXT, alias TEXT, kind TEXT);           -- name variants, "17/554", "Drs. 17/554"
CREATE TABLE external_id (entity_id TEXT, scheme TEXT, value TEXT);         -- wikidata, abgeordnetenwatch, dip_person, dip_vorgang, eli
CREATE TABLE predicate   (id TEXT PRIMARY KEY, label_de TEXT, label_en TEXT, inverse_en TEXT, domain TEXT, range TEXT, interpretive INTEGER);
CREATE TABLE statement (
  id TEXT PRIMARY KEY, subj TEXT, pred TEXT, obj TEXT, value TEXT,          -- obj OR value (literal)
  start TEXT, end TEXT, date_precision TEXT,                                -- ISO dates; precision day | month | year
  marker TEXT NOT NULL, rationale TEXT, supersedes TEXT
);
CREATE TABLE evidence (statement_id TEXT, doc_id TEXT, page INTEGER, locator TEXT, quote TEXT, read_via TEXT);

CREATE TABLE document (
  id TEXT PRIMARY KEY, kind TEXT, issuer TEXT, number TEXT, wp INTEGER, date TEXT,
  title TEXT, file_path TEXT, source_url TEXT, sha256 TEXT, pages INTEGER
);
CREATE TABLE page  (doc_id TEXT, page_no INTEGER, text TEXT, read_via TEXT, PRIMARY KEY (doc_id, page_no));
CREATE TABLE chunk (id INTEGER PRIMARY KEY, doc_id TEXT, page_from INTEGER, page_to INTEGER, text TEXT);
CREATE VIRTUAL TABLE chunk_fts USING fts5(text, content='chunk', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE chunk_vec (chunk_id INTEGER PRIMARY KEY, v BLOB);              -- float32[384], L2-normalised
CREATE TABLE mention (chunk_id INTEGER, entity_id TEXT, start INTEGER, end INTEGER, method TEXT,
                      status TEXT NOT NULL DEFAULT 'auto');   -- auto | confirmed | rejected (review queue)

CREATE TABLE vote_event (id TEXT PRIMARY KEY, event_id TEXT, body TEXT, motion_doc TEXT, result TEXT,
                         yes INTEGER, no INTEGER, abstain INTEGER, source_doc TEXT, locator TEXT);
CREATE TABLE vote (vote_event_id TEXT, person_id TEXT, option TEXT, group_id TEXT, locator TEXT);
CREATE TABLE observation (id TEXT PRIMARY KEY, metric TEXT, value REAL, unit TEXT, period_start TEXT, period_end TEXT,
                          place_id TEXT, doc_id TEXT, locator TEXT, note TEXT);
```

As built in phase 1 (`build/lib/db.ts`), the schema differs in three points:
- A logical `document` (a Drucksache) has one or more physical `file` rows. In Sachsen, question and answer are
  separate PDFs. `page` and `chunk` hang off `file`.
- `statement` also records `method` (wiki, regex, dictionary, seed, wikidata) and `source` (wiki page and line, or
  file and page).
- `external_id` has a `status` (confirmed or unverified).

Indexes go on `statement(subj)`, `statement(obj)`, `statement(pred)`, `mention(entity_id)` and `vote(person_id)`. The
whole graph is small (thousands of statements), so recursive CTEs answer path questions directly:

```sql
-- every document chain from BR-Drs 569/13 to Art. 82 BayBO
WITH RECURSIVE path(node, trail) AS (
  SELECT 'doc/br-drs-569-13', 'doc/br-drs-569-13'
  UNION ALL
  SELECT s.obj, trail || ' > ' || s.obj FROM statement s JOIN path ON s.subj = path.node
  WHERE s.pred IN ('led_to','cites','responds_to','part_of','enacts','implements') AND instr(trail, s.obj) = 0
)
SELECT trail FROM path WHERE node = 'law/baybo-82';
```

## 5. Build pipeline

Plain TypeScript on Node 26: `node:sqlite` for the database and native type stripping (`node build/index.ts`), so the
build needs no compiler and no dependencies except the embedding model.

```text
1. inventory   manifest.tsv files → document rows (sha256 checked)
2. text        pdftotext per page; OCR with tesseract -l deu (tessdata_best) for the 16 scans → page rows (read_via recorded)
3. seed        data/*.csv (entities, aliases, external ids, predicates, concepts, places) → entity tables
3a. wikidata   resolve same_as for people, parties, Fraktionen, parliaments, ministries, laws, Länder and places
               (Wikidata API, cached in data/wikidata.csv; a candidate without a confirmed match is stored as unverified)
4. wiki        parse markdown tables (timeline, people, anfragen, roll calls) → events, statements, evidence
5. references  regex extraction of document references from page text and wiki → cites edges and unresolved list
6. mentions    dictionary entity linking on chunks: people, organisations, documents, laws, places, concepts → mention rows
7. votes       parse roll-call name lists (PlPr 18/44 pp. 3958–3963, BY PlPr 17/10 Anlage 3, BY PlPr 17/29 Anlage 1)
8. numbers     observation rows from a curated observations.csv (each with doc + page)
9. chunks      page-aware chunking (~1,500 chars, 200 overlap, never across documents) → FTS5
10. embed      multilingual embedding model → chunk_vec (used by the local server; "more like this" in both modes)
11. checks     every statement has evidence or marker; no dangling ids; vote totals match the protocol; report
12. export     10h.db for the local server; 10h-web.db (without the model, with neighbour lists) for the static site;
               JSON-LD dump for reuse
```

**Reference patterns** (step 5) cover the forms the corpus uses: `BT-Drs 18/1310`, `Drucksache 18/1310`,
`BR-Drs 155/14(B)`, `PlPr 18/44`, `BY Drs 17/2137`, `LT-Drs 17/2137`, `Drs. 5/14898`, `Vf. 14-VII-14`,
`WD 7 - 3000 - 042/19`, `§ 249 Abs. 3 BauGB`, `Art. 82 BayBO`. Context (issuer, WP) decides between Bundestag, Bayern
and Sachsen when the number alone is ambiguous. Unresolved references go into a build report, not into the graph. This
is how errors like DIP's "18/1850" for 18/1580 show up.

**Source of truth (decided).** The wiki stays the source of truth for everything it states: events, questions,
votes, roles and evidence. It was checked against the primary sources on 12.10.2026, and keeping a second copy of these
facts would let the two drift apart. The build parses its tables. Parser tests with golden files catch format changes,
and a table the parser cannot read fails the build. `data/` holds only what the wiki does not express: stable ids,
aliases, external ids (Wikidata, DIP, abgeordnetenwatch), predicates, the concept and place lists, `led_to` rationales
and observations. If parsing a table turns out to be brittle in practice, that table moves into `data/`, and the wiki
table is generated from it. Each such move is decided per table, not all at once.

**Entity linking scope (decided).** The full text is linked to six types: people, organisations, documents, laws,
places and concepts.
- People, documents and laws are matched by aliases and reference patterns. They are precise enough to accept
  automatically.
- Places come from a small gazetteer in `data/places.csv`: Länder, Regierungsbezirke, Planungsregionen, and the
  municipalities and districts named in the answers. Concepts come from `data/concepts.csv` as SKOS concepts with
  German alternative labels (e.g. 10H: "10 H", "10-H-Regelung", "zehnfache Gesamthöhe").
- Places and concepts produce more false positives ("Main" in Main-Rhön, "Abstand" in unrelated contexts). Their
  mentions start with `status = 'auto'` and go to a review list in the build report. Only `confirmed` mentions create
  `about` statements. `auto` mentions are used for search facets only, and are marked as unreviewed there.

**Embedding model.** A multilingual sentence model with German coverage, e.g. multilingual-e5-small (384 dimensions),
run at build time through transformers.js in Node. The same model must embed queries at run time; see 6.2.

## 6. Search

### 6.1 Hybrid retrieval

1. **Lexical:** FTS5 BM25 over chunks, with `remove_diacritics` and German-aware query expansion from the alias table
   (searching "10H" also finds "10 H", "10-H-Regelung", "zehnfache Höhe").
2. **Semantic:** cosine similarity of the query vector against `chunk_vec`.
3. **Fusion:** reciprocal rank fusion of both lists (k = 60), then group by document and keep the best two chunks per
   document as snippets with page numbers.
4. **Entity hits first:** if the query matches an entity alias ("Pronold", "17/554"), show its card above the text
   results.
5. **Facets:** document kind, parliament, Wahlperiode, year, person, party, concept, marker. Facet counts come from
   SQL on the fused result ids.
6. **Explain:** each hit shows whether it matched lexically, semantically or both, and which entities it mentions.

### 6.2 Where semantic search runs (decided: local only)

- **Local server:** `node app/serve.ts` uses `node:sqlite` and keeps the embedding model in memory. It provides the
  full hybrid search (6.1) through a small JSON API. This is the only place where queries are embedded.
- **Static site (GitHub Pages):** lexical search, entity hits and facets only, with no model download. The UI says
  that semantic search needs the local version. "More like this" still works, because the build stores the ten
  nearest neighbours of every chunk and document as precomputed lists in `10h-web.db`.

## 7. Visualisations

Each view answers one question. The rule for choosing: show the structure the data really has. The data is
multi-arena time series, small groups voting, and one-to-many Q&A. It is not a dense network.

| View | Question it answers | Form | Why this form |
| --- | --- | --- | --- |
| **Story timeline** (home) | What happened where, and in what order? | Swimlane timeline, 2012–2018. Lanes: Bayern (government, Landtag, court), Bund (government, Bundestag, Bundesrat), Sachsen, other Länder. Procedures are bars from introduction to promulgation; events are points; `led_to` and `responds_to` are arcs between lanes. | The story is about how a decision moves between arenas. Lanes keep the arenas apart and the arcs show the hand-overs (BY review → BR-Drs 569/13 → coalition agreement → BT-Drs 18/1310 → Art. 82 BayBO). Brush to zoom; click opens the entity. |
| **Procedure view** | Where is a bill in its process, and which document belongs to which step? | Stepped list on a time axis, one row per step (Gesetzentwurf, BR-Stellungnahme, Gegenäußerung, hearing, Beschlussempfehlung, vote, promulgation), with document chips. | A procedure is linear with branches (Stellungnahme ↔ Gegenäußerung). A flow chart would add nothing. |
| **Roll call** | How did each group vote, and who deviated? | Diverging stacked bars per Fraktion (yes / no / abstain / absent). Deviators are listed by name under their bar. Optional seat chart. | Bars allow exact comparison. The interesting facts are the few deviators (Göppel, Stein, Bülow), so they are named, not hidden in a hemicycle. |
| **Question matrix** | Who asked whom? | Heatmap: askers grouped by party (rows) × answering ministry and office holder (columns), cells = number of questions, with a time filter. | It makes "Reiche answered almost all of WP 17, Pronold all of 2014" visible at a glance. A force graph of the same data would be a hairball. |
| **Question flow over time** | When did parliaments ask, and did key events trigger them? | Small multiples: one bar series per parliament (BT, BY, SN), questions per month, coloured by asking party, with the key events as vertical rules. | It shows bursts (BY spring 2013, after the cabinet decision of 04.02.2014) against the story's own milestones. |
| **Person page** | What was this person's role, and when? | Gantt rows for mandates, posts and party, plus point marks for questions, speeches, votes and signatures. 1-hop ego network (radial, at most about 25 nodes) of documents and people. | Offices change during the story (Huber, Scharf, Morlok → Dulig). An ego network stays readable where a global network would not. |
| **Evidence panel** | How do we know? | Under every fact: source chip (document, page, locator), the quote, the marker badge and how the text was read (text layer or OCR). Wiki-wide: one stacked bar of statements by marker. | It makes the research standard visible and invites verification. |
| **Effects** | What changed after 10H? | Bar chart of applications and approvals in Bayern per year or quarter, with 21.11.2014 marked. Each bar links to its source answer (e.g. BY 17/9570, 17/12258, 17/12706). | The numbers are scattered across government answers. Putting them on one axis is where the data gains meaning. Bars are used, not a line, because the periods differ between answers; they are drawn as reported, never interpolated. |
| **Länder status** | Which Länder used or debated the clause? | Tile grid map of the 16 Länder (equal tiles), coloured by status (used, debated, rejected, no record). | A geographic map would make Bayern dominate by area. Tiles treat each Land equally. |
| **Document reader** | What does the source say? | The PDF at the cited page (`#page=n`), next to the extracted text with linked entity mentions and outgoing and incoming references. | Every view ends in the primary source. |

General rules: one accent colour per lane or arena; party colours only where party is the variable; dark mode via
CSS custom properties; every chart has a table fallback and an accessible label; the URL holds all view state, so
any view can be shared.

## 8. Front end

- **Plain TypeScript** compiled by `tsc` to ES modules (no bundler, no framework). One module per view, a small hash
  router, and `<template>` elements for markup.
- **SQLite in the browser:** the official `@sqlite.org/sqlite-wasm` build (FTS5 is included), loading `10h.db` over
  HTTP into memory. About 9.5 million characters of text plus metadata gives a database of roughly 15–25 MB before
  compression; GitHub Pages serves it gzipped.
- **Charts:** hand-written SVG. Timelines, bars, heatmaps and Gantt rows need only scales and axes, a few hundred lines
  in total. No chart library.
- **One runtime dependency in the browser:** sqlite-wasm. transformers.js runs only in the build and in the local
  server.

```text
app/
  CONCEPT.md
  data/            seed CSVs: entities, aliases, external_ids, wikidata, predicates, concepts, places, led_to, observations
  build/           node:sqlite pipeline (steps 1–12), parser tests with golden files
  web/
    index.html
    src/           router.ts, db.ts, search.ts, views/*.ts, charts/*.ts
    dist/          tsc output (gitignored)
  serve.ts         local server with semantic search
```

## 9. Phases

| Phase | Result | Checks |
| --- | --- | --- |
| 1. Database | Pipeline steps 1–6 and 9, including German OCR of the 16 scans and the Wikidata links (step 3a); `10h.db` with documents, pages, entities, statements from the wiki, FTS5 | Build report: every wiki reference resolves; parser goldens pass; every Wikidata link confirmed or marked unverified |
| 2. Read-only app | Lexical search, entity pages, document reader, evidence panel, mention review list | Every fact in the UI links to a page |
| 3. Story | Story timeline, procedure view, roll calls (step 7) | Vote totals equal the protocol (465 : 114 : 3; 108 : 467; 96 : 66 : 1; 92 : 63) |
| 4. Meaning | Question matrix and flow, effects chart (step 8), Länder tiles, `led_to` rationales, `about` links from confirmed place and concept mentions | Each observation cites doc and page |
| 5. Semantic (local) | Embeddings, local server with hybrid search, precomputed neighbours for "more like this" | A fixed list of test queries with expected top hits (e.g. "Regierung verweigert Auskunft 10H" → SN 5/14898, SN 6/466) |
| 6. Publish | Static export (lexical search) to GitHub Pages; JSON-LD dump | Lighthouse, size budget |

## 10. Decisions (12.10.2026)

| Question | Decision | Where it shows |
| --- | --- | --- |
| Semantic search in the static site | Local server only. The static site has lexical search and precomputed "more like this". | 6.2, 8, phases 5–6 |
| Source of truth | The wiki stays the source of truth for the facts it states; `data/` holds identity data, vocabularies and observations. A table moves to `data/` only if parsing it proves brittle. | 5 |
| OCR quality | German traineddata installed (`deu`, tessdata_best); the 16 scans are OCRed with `-l deu` in the build. | 5, step 2 |
| Entity linking scope | People, organisations, documents, laws, places and concepts. Places and concepts go through a review queue. | 4.4 (`mention.status`), 5 |
| Wikidata | `same_as` links in phase 1, for people, parties, Fraktionen, parliaments, ministries, laws, Länder and places. | 5, step 3a; phase 1 |
