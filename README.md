# How Bayern got 10H

A source-based reconstruction of how Bayern came to require wind turbines to stand ten times their height away from
housing (the **10H rule**). It covers 2013 to 2016:

- **05.03.2013:** Seehofer orders a review of height-based distances.
- **2013:** Bundesrat bills from Sachsen and Bayern.
- **27.11.2013:** the federal coalition agreement.
- **2014:** the federal Länderöffnungsklausel, § 249 Abs. 3 BauGB.
- **2014:** Bayern's 10H law, Art. 82 BayBO.
- **2016:** the Bavarian constitutional court upholds it.

Under 10H, a turbine loses its privileged status in the outer zone (§ 35 Abs. 1 Nr. 5 BauGB) if it stands closer to
housing than ten times its total height. A 200 m turbine therefore needs 2,000 m.

Every statement is backed by a primary document: Drucksachen, plenary and committee protocols, government answers,
court rulings and freedom-of-information releases. Local copies of these documents are kept in this repository.

## Start here

- **[10h-wiki/README.md](10h-wiki/README.md):** the wiki index, a check of the starting thesis, the key documents and
  the roll-call votes.
- **[10h-wiki/timeline.md](10h-wiki/timeline.md):** every date on one page.
- **[10h-wiki/open-questions.md](10h-wiki/open-questions.md):** what is still missing.

## Contents

| Path | What it holds |
| --- | --- |
| [10h-wiki/](10h-wiki/README.md) | The wiki, by topic: origin in Bayern, Bundesrat bills, the federal clause, Art. 82 BayBO, Sachsen, other Länder, parliamentary questions, research services, FragDenStaat, sources. |
| [10h-wiki/people/](10h-wiki/people.md) | 81 profiles of the politicians involved: offices, roles, votes and parliamentary activity. Built from the Bundestag DIP API and abgeordnetenwatch.de, checked against the protocols. |
| [10h-wiki/anfragen/](10h-wiki/anfragen/README.md) | 82 PDFs of parliamentary questions with their answers, from the Bundestag, Bayern, Sachsen and Mecklenburg-Vorpommern. |
| [10h-wiki/pdfs/](10h-wiki/pdfs/README.md) | 59 other source PDFs: bills, protocols, research-service papers, the court ruling, coalition agreements and FragDenStaat releases. |
| [10h-wiki/request-stmuv-2013.md](10h-wiki/request-stmuv-2013.md) | Draft information request to the Bavarian environment ministry for the 2013 review order (not sent). |
| [10h-windkraft-2013-2014.md](10h-windkraft-2013-2014.md) | The initial research report of 11.10.2026. It is a frozen snapshot: corrections and new findings go into the wiki only. |

## Conventions

- The text is in English. German legal and parliamentary terms and all quotes stay in German, verbatim.
- Links in the text point to the original source URL. The local copy is listed in the archive READMEs.
- Markers:
  - **[secondary]**: only a secondary source backs the statement.
  - **[not verified]**: the statement is not confirmed.
  - Anything unmarked was checked against the primary document.

## Verifying the archive

Each archive folder has a `manifest.tsv` without a header: file name, source URL, size in bytes and SHA-256. To
check every file, run from `10h-wiki/`:

```sh
for d in pdfs anfragen/*; do [ -s $d/manifest.tsv ] && (cd $d && awk -F'\t' '{print $4"  "$1}' manifest.tsv | shasum -a 256 -c --quiet && echo "$d ok"); done
```

## Sources and rights

The documents in `pdfs/` and `anfragen/` were published by:

- the Bundestag, the Bundesrat and the Bundestag's research services;
- the Bayerischer Landtag, the Sächsischer Landtag and the Landtag Mecklenburg-Vorpommern;
- the Bavarian constitutional court (BayVerfGH);
- federal and Land ministries, through FragDenStaat.

They are archived here as research evidence. The rights stay with their issuers. Most of them are amtliche Werke
(§ 5 UrhG). Expert statements and other attachments may be protected by copyright.

The Saxon documents were fetched from the Landtag's EDAS server, whose `robots.txt` disallows automated access. They
were fetched once, deliberately, at a low request rate, for this research.

The data from abgeordnetenwatch.de used in the profiles is CC0.

## Status

Research status: 12.10.2026. See [open-questions.md](10h-wiki/open-questions.md) for what is still open.
