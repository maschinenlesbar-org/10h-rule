# 10H Explorer

Builds a SQLite database from the 10H research: the wiki in `../10h-wiki/`, the archived PDFs, and the vocabularies
in `data/`, and serves it as a local web app or as a static site. See [CONCEPT.md](CONCEPT.md) for the design. All six
phases are built:
- phase 1: database and pipeline;
- phase 2: read-only app with search, entity pages, document reader, evidence and the review list;
- phase 3: story timeline, procedures, and roll calls with individual votes;
- phase 4: who asked whom, the effects of 10H in the government's own numbers, the Länder map, `about` links;
- phase 5: semantic search (local only) and "more like this";
- phase 6: static export with JSON-LD dump.

## Requirements

- Node 24 or newer. TypeScript runs directly through Node's type stripping, with no compile step.
- `pdftotext` and `pdftoppm` (poppler), and `tesseract` with German language data (`deu`) for the scanned pages.
- Network access for the first Wikidata lookup and the first download of the embedding model (about 570 MB, cached in
  `.cache/models/`). After that, everything runs offline.
- `npm install` once, for the embedding runtime (`@huggingface/transformers`) and the browser SQLite (`@sqlite.org/sqlite-wasm`).

## Commands

```sh
npm run serve            # the app at http://localhost:8710/ (needs out/10h.db)
npm run serve:review     # same, but review decisions are saved (database + data/mention-review.csv)
npm run build            # out/10h.db and out/report.md
npm run build:offline    # no Wikidata requests; uses data/wikidata.csv as it is
npm run build:fast       # offline and without embeddings: keyword search only, no "more like this"
node build/index.ts --no-ocr   # skip OCR (pages without a text layer stay empty)
node serve.ts --no-semantic    # serve without loading the embedding model
npm run export           # dist/: the static site (add -- --no-files to leave out the PDFs)
npm run serve:static     # preview dist/ at http://localhost:8720/
npm test                 # unit tests, the wiki golden test, query and semantic tests (skipped without a build)
npm run typecheck        # needs `npm install` once (typescript, @types/node)
```

OCR results are cached in `.cache/text/`, keyed by the SHA-256 of each file, and embeddings in
`.cache/embed-<model>.sqlite`, keyed by the SHA-256 of each chunk. Only new or changed text is processed again. A full
build without caches takes about 45 minutes, almost all of it embedding (about 3.5 chunks/s on a laptop CPU); with
cached embeddings it takes about 4 minutes, most of it computing the neighbours.

## The app

`serve.ts` uses only Node built-ins. It serves a JSON API over `out/10h.db` (`server/queries.ts`), the front end in
`web/`, and the archived PDFs (only files listed in a manifest). It binds to 127.0.0.1. The front end is plain
TypeScript without a framework. The server strips the types on request (`node:module` `stripTypeScriptTypes`), so
there is no compile step. Routes:

| Route | View |
| --- | --- |
| `#/questions` | Who asked whom: a matrix of the asker's party against the person or ministry that answered, and a strip of the questions over time per parliament with the story's milestones. Filter by parliament |
| `#/effects` | Applications, approvals and commissioned turbines in Bayern, from the government's answers. One chart per measure and counting period (month, quarter, year), with the cut-off date and the day 10H came into force. Every figure in the table links to its page |
| `#/laender` | Which Länder used § 249 Abs. 3 BauGB: a tile map (equal tiles) and a table with summary, marker and source |
| `#/story` | Story timeline: one lane per arena, procedures as bars, events and roll calls as dots, interpretive links ("led to") as arcs, with their rationale and evidence listed below. Time-range presets |
| `#/search?q=` | Search, hybrid by default: full text (BM25) and semantic similarity, merged by reciprocal rank fusion. Each hit says whether it matched by words, by meaning or both. Concept aliases are expanded ("10H" also finds "10-H-Regelung"); facets for document type, parliament and year; matching entities first. A switch turns it into keyword-only search |
| `#/e/<id>` | Entity page: facts in both directions with marker, date and evidence chips; documents with files; "mentioned in". Procedures show their steps; roll calls show a stacked bar per Fraktion, the deviators and all names. Documents list similar documents |
| `#/read?file=&n=` | Document reader: page text with linked entities and references, the PDF at the same page, OCR warning, similar passages in other documents |
| `#/list/<kind>` | people, documents, events, concepts, organizations, places, laws |
| `#/review` | Mentions of organisations, places and concepts by surface form, with sample contexts; confirm or reject in review mode |

## What the build does

| Step | Module | Result |
| --- | --- | --- |
| 1 inventory | `steps/inventory.ts` | `document`, `file`: every manifest entry, checked against its SHA-256 |
| 2 text | `steps/text.ts` | `page`: pdftotext per page; pages without a text layer are OCRed with `tesseract -l deu` |
| 3 seed | `steps/seed.ts` | predicates, organisations, places, concepts and laws from `data/*.csv` |
| 4 wiki | `steps/wiki.ts` | people, events, questions and answers, speeches, roll-call totals, Anträge |
| 3a wikidata | `steps/wikidata.ts` | `external_id` (wikidata): people via abgeordnetenwatch id (P5355), everything else by label search |
| 4b answers | `steps/answers.ts` | `answered_for` statements: the ministry that answered each Bavarian Schriftliche Anfrage (from the answer's heading) and each wind question in the Anfragen zum Plenum (per asker, from the numbered question block) |
| 8b observations | `steps/observations.ts` | `observation` (figures from `data/observations.csv`) and `land_status` (`data/laender-status.csv`). Each figure's quote is looked up on its page; only found figures are charted |
| 5 references | `steps/references.ts` | `cites` statements from the full text, with page evidence |
| 9 chunks | `steps/chunks.ts` | `chunk` and the FTS5 index `chunk_fts` |
| 6 mentions | `steps/mentions.ts` | `mention`: entity linking on chunks |
| 7 votes | `steps/votes.ts` | `vote`: individual votes from the roll-call lists (word positions via `pdftotext -bbox-layout`). The totals must equal the protocol |
| 8 procedures | `steps/procedures.ts` | procedures (`data/procedures.csv`) and curated links (`data/links.csv`). A link's evidence quote must be found on a page of the cited document |
| 6b about | `steps/about.ts` | `about` statements: a document is about a place or concept when it has at least 3 confirmed mentions on at least 2 pages (running heads skipped) |
| 10 embed | `steps/embed.ts` | `chunk_vec` (one vector per chunk), `chunk_neighbor` and `doc_neighbor` (top 10 from other documents) |
| 11 checks | `steps/checks.ts` | dangling ids, roll-call totals against the protocols; failures make the build exit 1 |

## Semantic search

The model is [BAAI bge-m3](https://huggingface.co/BAAI/bge-m3) (the `Xenova/bge-m3` ONNX export, 8-bit, 1024
dimensions), run locally with transformers.js; nothing leaves the machine. It was chosen on seven German questions
against the whole corpus: on its own it put a target document in the top 5 for 5 of 7 questions, multilingual-e5-small
for 4 of 7.

Two rules make questions in plain language work:
- In hybrid mode the keyword half searches for any content word of the question (stopwords removed), so a question
  still finds documents that share only some of its words.
- The semantic half leaves out "10H" (and "10 H", "10-H-Regelung", …) when at least two content words remain. Every
  document here is about 10H, so the word only pulls a question toward generic 10H texts: "Ist die 10H-Regel
  verfassungsgemäß?" ranked the ruling 15th with it and 3rd without it.

`test/semantic.test.ts` holds five test questions; hybrid search finds a target in the top 5 for four of them. The
known miss is "Regierung verweigert Auskunft 10H": the Saxon refusals share no words with it ("Kernbereich exekutiver
Eigenverantwortung"), and semantically they rank 8th.

The server loads the model in the background at start; until it is ready, search falls back to keywords.

## Static site

`npm run export` writes `dist/`, which any static host can serve (GitHub Pages included, `.nojekyll` is there):

- the app as plain JavaScript, sharing the query code with the server (`server/queries.ts`);
- `10h-web.db`, the database without vectors (about 41 MB, budget 60 MB), opened in the browser with sqlite-wasm;
- the archived PDFs in `files/` (about 104 MB);
- `10h.jsonld`: every entity with its statements and evidence (schema.org types, SKOS for concepts, `owl:sameAs` for
  Wikidata).

The static site has keyword search and the precomputed "more like this"; semantic search needs the local server,
because the model is too large to ship. Review mode is local only.

### Deploying to GitHub Pages

`.github/workflows/pages.yml` (in the repository root) builds the database, runs the tests, exports and deploys `dist/`
on every push to `main` that touches the wiki or the app, and on demand (Actions → Deploy 10H Explorer → Run workflow).
Enable it once under Settings → Pages → Build and deployment → Source: **GitHub Actions**.

The workflow runs on Ubuntu 24.04 with its poppler and tesseract. It builds offline, so Wikidata links come from
`data/wikidata.csv` as reviewed. `app/.cache` is kept between runs: the first run OCRs the scans and embeds every
chunk (about an hour), later runs take a few minutes. A failed build check or test stops the deployment.

## Review status (13.10.2026)

- **`data/wikidata.csv`:** all 166 links are confirmed. 81 people were matched exactly by their abgeordnetenwatch id
  (P5355). The rest were checked one by one against the item's label and description; 5 wrong matches are kept as
  `rejected`.
- **`data/mention-review.csv`:** every dictionary match for organisations, places and concepts has a decision (192
  rows, reviewer "Claude": identity checked in 2–4 random contexts per entity and surface form). Decisions apply to
  one entity and surface form. An optional `scope` (a parliament code) limits a decision to that parliament's documents:
  "Staatskanzlei" is confirmed only in Bavarian documents. Systematically wrong aliases were removed from the
  vocabulary instead of being rejected ("Stichtag", "Außenbereich", bare "Gebietskulisse", plural
  "Länderöffnungsklauseln"). "CDU/CSU" now links to the CDU/CSU-Bundestagsfraktion, not to the CDU.
- New aliases or documents create new open mentions. Review them in the app (`npm run serve:review`, then Review),
  or add rows to the CSV.
- **`out/report.md`:** unresolved references, askers not matched to a person, people without a profile, pages
  without text.

## Curated data

| File | Content | Source |
| --- | --- | --- |
| `data/procedures.csv` | Six procedures with dates, status and documents | Wiki pages named in the `source` column |
| `data/links.csv` | Five interpretive "led to" links and one "implements" link, each with a rationale and an evidence quote | Wiki findings; the quote is checked against the PDF text at build time |
| `data/observations.csv` | 357 figures (applications, approvals, turbines commissioned and in operation, …) with period, place, document and the quote they come from | Answers of the Bavarian Staatsregierung and the Bundesregierung. Where two answers disagree (e.g. 64 or 62 approvals in 2015), both are kept and the note says so |
| `data/laender-status.csv` | Use of the Länderöffnungsklausel by each Land | Wiki pages named in the `source` column |
| `data/fraktion-documented.csv` | The Fraktion of members for whom abgeordnetenwatch only has a later state (Förster: "fraktionslos" after 2016; Muthmann: FDP from 2018), with the dated documents that show it | Plenarprotokolle and Drucksachen of the Landtag; the quote is checked on the page at build time |
| `data/members-by-17.csv` | Bayerischer Landtag WP 17 mandates and Fraktion, used for the Bavarian roll calls | abgeordnetenwatch.de API v2 (CC0), fetched 13.10.2026. The Fraktion on the vote date comes from the wiki profile first, then from `data/fraktion-documented.csv`, then from abgeordnetenwatch if valid on that date; otherwise it is "unknown". Every member of both Bavarian roll calls has a Fraktion |

## Querying

```sql
-- who answered which Bundestag question
SELECT e.label, s.obj, s.value, s.start FROM statement s JOIN entity e ON e.id = s.subj WHERE s.pred = 'answered';

-- full text, with page numbers
SELECT c.doc_id, c.page_from, snippet(chunk_fts, 0, '[', ']', '…', 12)
FROM chunk_fts JOIN chunk c ON c.id = chunk_fts.rowid WHERE chunk_fts MATCH 'Kernbereich exekutiver' ORDER BY bm25(chunk_fts);

-- every statement about a person, with evidence
SELECT s.pred, s.obj, s.value, s.marker, ev.doc_id, ev.page FROM statement s LEFT JOIN evidence ev ON ev.statement_id = s.id
WHERE s.subj = 'person/florian-pronold';
```
