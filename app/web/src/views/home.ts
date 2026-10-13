import { api } from '../api.ts';
import { h, setTitle } from '../dom.ts';

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
      h('input', { name: 'q', type: 'search', placeholder: 'Search 3,300 pages of Drucksachen, protocols and answers', 'aria-label': 'Search' }),
      h('button', { type: 'submit' }, 'Search')),
    h('p', {}, h('a', { href: '#/story', class: 'button primary' }, 'Follow the story on a timeline →')),
    h('p', { class: 'examples' }, 'Try: ', ...EXAMPLES.flatMap((x, i) => [i ? ' · ' : '', h('a', { href: `#/search?${new URLSearchParams({ q: x })}` }, x)])),
    h('div', { class: 'stats' },
      stat(c.archived, 'archived documents', '#/list/documents'),
      stat(c.pages, 'pages of text'),
      stat(c.Person, 'people', '#/list/people'),
      stat(c.Event, 'events', '#/list/events'),
      stat(c.citations, 'citation links'),
      stat(c.review, 'mentions to review', '#/review')),
    h('section', {},
      h('h2', {}, 'How sure is each fact?'),
      h('p', {}, `${totalFacts.toLocaleString('en')} facts come from the wiki and the vocabularies. `,
        `${(m.markers.primary ?? 0).toLocaleString('en')} are checked against a primary document, `,
        `${m.markers.secondary ?? 0} rest on secondary sources only, and ${m.markers.unverified ?? 0} are not verified. `,
        'Citation links are extracted from the full text and point to the page they were found on.')),
    h('p', { class: 'muted small' }, `Database built ${new Date(m.built_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}.`));
}
