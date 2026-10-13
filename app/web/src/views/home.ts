import { api, isStatic } from '../api.ts';
import { h, setTitle, entityHref } from '../dom.ts';

// The story in four sentences; every step links to its record. Text: the wiki's timeline and the event entries.
const e = (id: string, text: string) => h('a', { href: entityHref(id) }, text);
const summary = () => h('div', { class: 'summary' },
  h('h2', {}, 'The story in brief'),
  h('p', {},
    'On 05.03.2013 Ministerpräsident Seehofer ', e('event/2013-03-05-seehofer-and-umweltminister-marcel-huber', 'asked his environment minister to review height-based distances'),
    ' for wind turbines. Federal law privileges turbines in the outer zone (§ 35 BauGB), so Bayern needed Berlin: ',
    e('event/2013-05-03-the-bundesrat-refuses-to-introduce', 'a Saxon Bundesrat bill failed'), ' in May 2013, and Bayern and Sachsen tabled ',
    e('doc/br-drs-569-13', 'a joint bill, BR-Drs 569/13'), '.'),
  h('p', {},
    'The ', e('event/2013-11-27-the-federal-coalition-agreement-cdu-csu-spd', 'federal coalition agreement of 27.11.2013'),
    ' promised a Länderöffnungsklausel. The Bundestag ', e('event/2014-06-27-the-bundestag-passes-the-bill', 'passed it on 27.06.2014'),
    ' (', e('doc/bt-drs-18-1310', 'BT-Drs 18/1310'), '), and ', e('law/baugb-249-3', '§ 249 Abs. 3 BauGB'), ' entered into force on 01.08.2014.'),
  h('p', {},
    'Bayern is the only Land this research found to ', h('a', { href: '#/laender' }, 'have used the clause'), ': the Landtag ',
    e('event/2014-11-12-the-bayerischer-landtag-passes-10h', 'passed 10H on 12.11.2014'), ' (', e('procedure/by-10h-law', 'Art. 82 BayBO'),
    '), and on 09.05.2016 ', e('event/2016-05-09-the-bavarian-constitutional-court-upholds', 'the Bavarian constitutional court upheld it'), '.'));

const EXAMPLES = ['10H', 'Kernbereich exekutiver Eigenverantwortung', 'Länderöffnungsklausel', 'Vertrauensschutz', 'BT-Drs 18/1310', 'Pronold'];

export async function home(): Promise<Node> {
  setTitle('');
  const m = await api.meta();
  const c = m.counts;
  const stat = (n: number | undefined, label: string, href?: string) =>
    h('div', { class: 'stat' }, h('div', { class: 'stat-n' }, (n ?? 0).toLocaleString('en')), href ? h('a', { href }, label) : h('div', {}, label));
  const totalFacts = Object.values(m.markers).reduce((a, b) => a + b, 0);
  return h('div', { class: 'home' },
    h('h1', {}, 'How Bayern got 10H'),
    h('p', { class: 'lede' },
      'The record behind the ten-times-height rule for wind turbines, 2013–2016: documents, people, events and the links between them. ',
      'Every fact points to a primary source.'),
    h('form', { class: 'big-search', role: 'search', onsubmit: (e: Event) => {
      e.preventDefault();
      const q = ((e.target as HTMLFormElement).elements.namedItem('q') as HTMLInputElement).value.trim();
      if (q) location.hash = `#/search?${new URLSearchParams({ q })}`;
    } },
      h('input', { name: 'q', type: 'search', placeholder: `Search ${(c.pages ?? 0).toLocaleString('en')} pages`, title: 'Drucksachen, protocols, answers and rulings', 'aria-label': 'Search' }),
      h('button', { type: 'submit' }, 'Search')),
    h('p', { class: 'examples' }, 'Try: ', ...EXAMPLES.flatMap((x, i) => [i ? ' · ' : '', h('a', { href: `#/search?${new URLSearchParams({ q: x })}` }, x)])),
    summary(),
    h('p', {}, h('a', { href: '#/story', class: 'button primary' }, 'Follow the story on a timeline →')),
    h('div', { class: 'stats' },
      stat(c.archived, 'archived documents', '#/list/documents'),
      stat(c.pages, 'pages of text'),
      stat(c.Person, 'people', '#/list/people'),
      stat(c.Event, 'events', '#/list/events'),
      stat(c.citations, 'citation links'),
      isStatic
        ? h('div', { class: 'stat' }, h('div', { class: 'stat-n' }, `${Math.round(100 * (m.markers.primary ?? 0) / (totalFacts || 1))} %`), h('a', { href: '#/about' }, 'of facts checked against the primary source'))
        : stat(c.review, 'mentions to review', '#/review')),
    h('section', {},
      h('h2', {}, 'How sure is each fact?'),
      h('p', {}, `${totalFacts.toLocaleString('en')} facts come from the wiki and the vocabularies. `,
        `${(m.markers.primary ?? 0).toLocaleString('en')} are checked against a primary document, `,
        `${m.markers.secondary ?? 0} rest on secondary sources only, and ${m.markers.unverified ?? 0} are not verified. `,
        'Citation links are extracted from the full text and point to the page they were found on.')),
    h('p', { class: 'muted small' }, h('a', { href: '#/about' }, 'About this site, its sources and downloads'), ' · ', `Database built ${new Date(m.built_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}.`));
}
