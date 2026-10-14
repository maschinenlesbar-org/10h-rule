// About: who made this, how the record was built, where the data comes from, how it may be reused, and downloads.
import { api, isStatic } from '../api.js?v=e7a98de609';
import { h, setTitle } from '../dom.js?v=e7a98de609';

const REPO = 'https://github.com/maschinenlesbar-org/10h-rule';
const ext = (href        , text        ) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

export async function aboutView()                {
  setTitle('About');
  const m = await api.meta();
  const c = m.counts;
  return h('div', { class: 'about prose' },
    h('h1', {}, 'About the 10H Explorer'),
    h('p', { class: 'lede-small' },
      'A source-based reconstruction of how Bayern came to require wind turbines to stand ten times their height away from housing. ',
      'It is made by ', ext('https://maschinenlesbar.org/', 'maschinenlesbar.org'), ', which builds tools for open German public-sector data.'),

    h('h2', {}, 'How the record was built'),
    h('ol', {},
      h('li', {}, 'The research started from the primary documents: Drucksachen, plenary and committee protocols, government answers to parliamentary questions, the court ruling and freedom-of-information releases. ',
        `${(c.archived ?? 0).toLocaleString('en')} of them are archived here, with a SHA-256 checksum for each file.`),
      h('li', {}, 'The findings were written up in a ', ext(`${REPO}/tree/main/10h-wiki`, 'research wiki'), '. Every statement there carries a marker: unmarked means checked against the primary document; ',
        h('em', {}, 'secondary'), ' means only a secondary source backs it; ', h('em', {}, 'not verified'), ' means it is not confirmed.'),
      h('li', {}, 'A build step reads the wiki and the PDFs into one database. Pages without a text layer were read by OCR (marked “OCR text” in the reader, as it can contain errors). ',
        'People, organisations, places, concepts and laws are linked by dictionary; every link for an organisation, place or concept was reviewed one by one, in sample contexts.'),
      h('li', {}, 'Citations between documents are extracted from the full text, each with the page it was found on. The “led to” links of the story are interpretations: each has a rationale and a quote that the build checks against the cited page.'),
      h('li', {}, 'The ', h('a', { href: '#/bibliography' }, 'bibliography'), ' lists what the documents cite from outside the archive: parliamentary documents, court decisions, legislation, legal literature and web sources. It is found by pattern and not reviewed; books other than commentaries are not recognised.')),

    h('h2', {}, 'Sources'),
    h('ul', {},
      h('li', {}, ext('https://dip.bundestag.de/', 'DIP'), ', the documentation system of the Bundestag and the Bundesrat, and the Bundestag’s research services.'),
      h('li', {}, 'The ', ext('https://www.bayern.landtag.de/', 'Bayerischer Landtag'), ', the ', ext('https://www.landtag.sachsen.de/', 'Sächsischer Landtag'), ' and the Landtag Mecklenburg-Vorpommern.'),
      h('li', {}, 'The Bavarian constitutional court (BayVerfGH).'),
      h('li', {}, 'Federal and Land ministries, through ', ext('https://fragdenstaat.de/', 'FragDenStaat'), '.'),
      h('li', {}, ext('https://www.abgeordnetenwatch.de/', 'abgeordnetenwatch.de'), ' for mandates and votes (CC0) and ', ext('https://www.wikidata.org/', 'Wikidata'), ' for identifiers (CC0).')),

    h('h2', {}, 'Rights and reuse'),
    h('p', {}, 'The archived documents are kept as research evidence; the rights stay with their issuers. Most are amtliche Werke (§ 5 UrhG). Expert statements and other attachments may be protected by copyright. ',
      'Each document page links to the original at its source.'),

    h('h2', {}, 'Downloads'),
    h('ul', {},
      h('li', {}, 'The bibliography as CSV, from the ', h('a', { href: '#/bibliography' }, 'Bibliography'), ' page (Download CSV).'),
      h('li', {}, h('a', { href: '10h.jsonld', download: '' }, '10h.jsonld'), ': every entity with its statements and evidence as JSON-LD (schema.org, SKOS, owl:sameAs to Wikidata).'),
      isStatic ? h('li', {}, h('a', { href: '10h-web.db', download: '' }, '10h-web.db'), ': the SQLite database this site runs on, with full text and an FTS5 index.') : null,
      h('li', {}, ext(REPO, 'The repository'), ': the wiki, the archived PDFs with their manifests, and the code of this site.')),

    h('h2', {}, 'Limits'),
    h('ul', {},
      isStatic ? h('li', {}, 'The search here matches words. Search by meaning needs the local server with the embedding model (see the repository).') : null,
      h('li', {}, 'The research covers what it found. A Land marked “no record” on the Länder page was not searched exhaustively.'),
      h('li', {}, 'Open gaps are listed in the wiki’s ', ext(`${REPO}/blob/main/10h-wiki/open-questions.md`, 'open questions'), '.')),

    h('p', { class: 'muted small' }, `Database built ${new Date(m.built_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}.`));
}
