# Security review: 10H Explorer

Review of 13.10.2026, at commit `f1cf72c`. Scope: the whole repository.

- **Code:** the build pipeline (`app/build/`), the local server (`app/serve.ts`, `app/server/queries.ts`), the front end
  (`app/web/`), the static export (`app/export.ts`, `app/export-pages.ts`, `app/serve-static.ts`) and the deploy script
  (`app/publish-pages.sh`).
- **Configuration:** the repository configuration (`.claude/settings.json`).
- **Published site:** https://maschinenlesbar.org/10h-rule/.

## Threat model

The site is public and read-only. It holds no accounts, cookies, secrets or personal data beyond what the source
documents publish. The main risks are:

- **Untrusted input:** the archived PDFs, their OCR text and the patterns extracted from them reach the browser, the
  database and the static pages. A PDF or a crafted page text must not be able to run script on the site.
- **Local server:** it runs on the maintainer's machine. In review mode it writes to `data/mention-review.csv`, a
  curated file that is committed and published.
- **Integrity of the record:** what is deployed should be exactly the reviewed archive and code.

Nothing was changed in the code for this review. The findings below were checked by reading the code and, where noted,
by tests against a running local server.

## Summary

| # | Finding | Severity | Where |
| --- | --- | --- | --- |
| 1 | Review endpoint accepts cross-site and DNS-rebinding requests (**fixed**) | Medium | `app/serve.ts:84`, `:101` |
| 2 | Checksum mismatches do not stop the build (**fixed**) | Medium | `app/build/steps/inventory.ts:81` |
| 3 | No Content Security Policy on the site | Low | `app/web/index.html`, `app/export.ts:65`, `app/export-pages.ts` |
| 4 | Link URLs are not checked for their scheme | Low | `app/web/src/views/entity.ts:48`, `:62`; `app/build/steps/wiki.ts:48`; `app/build/steps/inventory.ts:88` |
| 5 | JSON-LD in static pages escapes `</` but not `<!--` | Low | `app/export-pages.ts:258` |
| 6 | Quadratic regular expression in the commentary pattern | Low | `app/build/lib/biblio.ts:112` |
| 7 | Server errors are returned to the client | Low | `app/serve.ts:117` |
| 8 | Review CSV: unchecked values, `\r` not quoted | Low | `app/serve.ts:101`, `app/build/lib/text.ts:31` |
| 9 | Web sources link to third-party sites from old documents | Info | `app/web/src/views/bibliography.ts:83` |
| 10 | Embedding model is not pinned to a revision | Info | `app/build/lib/embed.ts:21` |
| 11 | Deploys can come from an unreviewed working tree | Info | `app/publish-pages.sh:26` |
| 12 | Repository enables 34 Claude Code plugins on trust | Info | `.claude/settings.json` |

## Findings

### 1. Review endpoint accepts cross-site and DNS-rebinding requests (Medium, fixed)

`POST /api/review` (`app/serve.ts:101`) checks neither the `Host` header, the `Origin` header nor the content type:

- The request body is parsed as JSON whatever its `Content-Type`. A web page can therefore send a "simple" cross-site
  request (`Content-Type: text/plain`), which the browser sends without a CORS preflight.
- Any `Host` is accepted, so a DNS-rebinding page can also read the API as same-origin.

**Tested.** On a server without `--review`, a `text/plain` POST with `Origin: https://evil.example` reached the review
handler. It was stopped only by the review-mode check, which returned "start the server with --review". A request with
`Host: evil.example:8711` got `200` from `/api/meta`.

**Impact.** While `npm run serve:review` runs, any web page the maintainer opens can write review decisions:

- to the database's mention table;
- to `data/mention-review.csv`, with arbitrary `entity_id` and `surface` values (the server does not check that they
  exist).

That file is curated, committed and drives the next build, so a poisoned decision can reach the published site
unnoticed. The read API exposes only data that is public anyway.

**Fix:**

- Accept only `Host` values `localhost:<port>` and `127.0.0.1:<port>`.
- For POST, require `Content-Type: application/json` (this forces a preflight, which the server does not answer) and an
  `Origin` equal to the server's own origin.
- Reject decisions for an `entity_id`/`surface` pair with no mentions (`setReview` returns 0 changes), and do not write
  those to the CSV.

**Fixed (13.10.2026).** `app/serve.ts` now does the following:

- It answers only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]` on its own port.
- `POST /api/review` requires `Content-Type: application/json` and, when an `Origin` is sent, that it is the server's
  own. These checks come before the review-mode check.
- A decision that changes no mention gets 404 and is not written to the CSV.

`app/test/serve.test.ts` checks the refusals against a running server without review mode. A manual run in review mode
confirmed that an unknown decision leaves the database and `data/mention-review.csv` unchanged.

### 2. Checksum mismatches do not stop the build (Medium, fixed)

The inventory step compares every archived PDF with the SHA-256 in its `manifest.tsv` (`app/build/steps/inventory.ts:80`).
A mismatch is only listed in `out/report.md` (`:81`); the build and the deploy continue. A PDF that was replaced or
corrupted after it was archived is therefore published as if it were the verified source. That undermines the
archive's promise that each file matches its checksum.

**Fix:** count a mismatch as a check failure, as `app/build/steps/checks.ts` does for dangling ids, so that
`publish-pages.sh` stops before pushing.

**Fixed (13.10.2026).** A checksum mismatch, and a file listed in a manifest but missing, is now a hard failure:

- it appears in `out/report.md` under "FAIL: …";
- the build exits non-zero, which stops `publish-pages.sh`.

Checked by changing one checksum in `10h-wiki/pdfs/manifest.tsv`: the inventory step reported one failure. The
manifest was then restored.

### 3. No Content Security Policy on the site (Low)

Neither the app nor the static pages set a CSP, and GitHub Pages cannot send one as a header. No XSS was found: every
piece of document text goes through text nodes (`app/web/src/dom.ts`, `app/web/src/charts/svg.ts`), and the static pages
escape their HTML (`esc` in `app/export-pages.ts`). A CSP would contain a future mistake, which matters here because the
displayed text comes from untrusted PDFs.

**Fix:**

- Move the inline `window.TENH_STATIC` script (`app/export.ts:65`) into a file, or allow it by hash.
- Add a `<meta http-equiv="Content-Security-Policy">` to the app and the static pages, for example
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data:; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`.
  sqlite-wasm needs `wasm-unsafe-eval`; the PDF reader needs `frame-src 'self'`.

### 4. Link URLs are not checked for their scheme (Low)

The document source links and external-id links are written into `href` as they are (`app/web/src/views/entity.ts:48`,
`:62`; `app/export-pages.ts` escapes them as HTML but does not check the scheme). The URLs come from the manifests and
from Markdown links in the wiki (`app/build/steps/inventory.ts:88`, `app/build/steps/wiki.ts:48`). Today all 143 are
`http(s)`, checked in the database. A `javascript:` link in a wiki page, for example from a contributed edit, would
become stored XSS on the site.

A malformed URL also breaks the whole entity page, because `new URL(d.source_url).host` throws.

Web sources in the bibliography are safe: the pattern only takes `http(s)://` and `www.` addresses, and adds `https://`
to the latter.

**Fix:** accept only `http:` and `https:` when the build stores a URL, and report the rest. Guard the
`new URL(...)` call in the view.

### 5. JSON-LD in static pages escapes `</` but not `<!--` (Low)

`app/export-pages.ts:258` replaces `</` in the embedded JSON-LD, which stops the script element from being closed early
(a test covers this). It does not escape `<!--`, which together with `<script` can change how the HTML parser reads the
rest of the script block. The data comes from the wiki and the vocabularies, not from PDF text.

**Fix:** escape every `<` as `<` (and `>` as `>`) in the serialised JSON.

### 6. Quadratic regular expression in the commentary pattern (Low)

The commentary pattern `(AUTHOR(?:/AUTHOR)+),\s+(CODES)` (`app/build/lib/biblio.ts:112`) rescans the rest of a long run
of `Name/Name/…` from every starting point.

**Tested.** 80,000 characters of `Abc/` took 2.2 s, and the time grows quadratically. The other patterns stayed under
15 ms on 100,000–250,000 characters of hostile input. Pages in the corpus are far shorter, and the step runs only at
build time on archived PDFs, so a crafted PDF could slow the build but not the site.

**Fix:** bound the repetition, for example `(?:\/AUTHOR){1,6}`.

### 7. Server errors are returned to the client (Low)

The local server's catch-all handler returns `String(err)` (`app/serve.ts:117`). That can expose paths and internals.
The server binds to 127.0.0.1 (`:119`), so the exposure is small, but together with finding 1 a page could read the
messages.

**Fix:** log the error and return a generic message.

### 8. Review CSV: unchecked values, `\r` not quoted (Low)

`toCsv` (`app/build/lib/text.ts:31`) quotes fields that contain `"`, `,` or `\n`, but not `\r`. Values posted to the review
endpoint go into the CSV unchecked (see finding 1). A carriage return in a surface form could break the row structure
of a committed data file.

**Fix:** quote on `\r` as well, and validate the values (finding 1).

### 9. Web sources link to third-party sites from old documents (Info)

The bibliography links 351 web addresses extracted from documents written between 2006 and 2020
(`app/web/src/views/bibliography.ts:83`). Some domains may have changed owner since. The links open with
`rel="noopener"`.

**Fix:**

- Add `noreferrer nofollow`.
- Label the links as taken from the source documents, which the page already says in its introduction.

### 10. Embedding model is not pinned to a revision (Info)

The local server and the build download `Xenova/bge-m3` from Hugging Face on first use, at the latest revision
(`app/build/lib/embed.ts:21`). If the model repository changed upstream, the semantic search would change silently, and
the ONNX file is parsed by native code. The deploy does not depend on it: the published site has no semantic search, and
the vectors are cached.

**Fix:** pass a fixed `revision` (a commit hash).

### 11. Deploys can come from an unreviewed working tree (Info)

`app/publish-pages.sh` builds from the local checkout and publishes even when the tree has uncommitted changes. It
marks those builds `-dirty` (`:26`) and force-pushes over `gh-pages`. What is live can therefore differ from what is on
`main`.

**Fix:** refuse to publish unless the tree is clean and `HEAD` equals `origin/main`, with an explicit override.

### 12. Repository enables 34 Claude Code plugins on trust (Info)

`.claude/settings.json` enables 34 plugins from the `maschinenlesbar-org/plugins` marketplace for anyone who opens and
trusts the repository in Claude Code. CLAUDE.md names four that this research uses (dip-bundestag, abgeordnetenwatch,
bundesrat, fragdenstaat). The others add tools, and supply-chain surface, without a use here.

**Fix:** enable only the plugins the research needs.

## Checked and sound

- **No HTML injection from document text.** The front end builds the DOM with text nodes only. There is no `innerHTML`,
  `eval` or `document.write` anywhere in the app. Search snippets, the reader text, tooltips and chart labels all
  render as text. The reader escapes query terms before building its highlighting pattern.
- **SQL.** All queries use bound parameters. User search input reaches FTS5 only through `Queries.ftsQuery`, which
  quotes every term. The two `LIKE` patterns built from strings (`app/build/steps/bibliography.ts:70`, `app/build/steps/wiki.ts:221`) take build data, not user input, and are bound as parameters.
- **No shell.** External tools (`pdftotext`, `pdftoppm`, `tesseract`) are run with `execFile`/`execFileSync` and
  argument arrays, never through a shell.
- **Path traversal.** Both servers normalise paths and check that they stay inside their root. `/files/` serves only
  ids listed in the database. Tested: `..%2f`, `%2e%2e/` and plain `../` against both servers all return 404.
- **Local server.** It binds to 127.0.0.1, limits the request body to 100 KB, and enables the write endpoint only with
  `--review`.
- **Secrets.** There are no API keys or tokens in the code or in the git history; the DIP key is passed by environment
  as CLAUDE.md requires.
- **Published files.**
  - `10h-web.db`, `10h.jsonld` and `meta.json` contain no local paths or personal addresses.
  - The site loads no third-party scripts, fonts or trackers.
- **Dependencies.** `npm audit --omit=dev` reports 0 vulnerabilities.
- **Network access in the build.** Wikidata is queried over HTTPS, and only in online builds; deploys build offline
  from the reviewed `data/wikidata.csv`.

## Suggested order

1. Findings 1 and 2: fixed on 13.10.2026.
2. Findings 3 and 4: defence in depth for the public site.
3. The rest when the code is next touched.
