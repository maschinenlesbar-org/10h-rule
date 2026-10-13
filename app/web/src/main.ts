// Hash router. Routes: #/ · #/search?q= · #/e/<entity id> · #/read?file=&n= · #/list/<kind> · #/review
import { h, setTitle } from './dom.ts';
import { home } from './views/home.ts';
import { searchView } from './views/search.ts';
import { entityView } from './views/entity.ts';
import { readerView } from './views/reader.ts';
import { listView } from './views/lists.ts';
import { reviewView } from './views/review.ts';
import { storyView } from './views/story.ts';
import { questionsView } from './views/questions.ts';
import { effectsView } from './views/effects.ts';
import { laenderView } from './views/laender.ts';

const main = document.querySelector('main')!;
const searchForm = document.querySelector<HTMLFormElement>('#top-search')!;
const searchInput = searchForm.querySelector('input')!;

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/search?${new URLSearchParams({ q })}`;
});

type View = (params: URLSearchParams, rest: string) => Promise<Node>;
const routes: Array<[RegExp, View]> = [
  [/^\/?$/, home],
  [/^\/story$/, storyView],
  [/^\/questions$/, questionsView],
  [/^\/effects$/, effectsView],
  [/^\/laender$/, laenderView],
  [/^\/search$/, searchView],
  [/^\/e\/(.+)$/, entityView],
  [/^\/read$/, readerView],
  [/^\/list\/([a-z]+)$/, listView],
  [/^\/review$/, reviewView],
];

let seq = 0;
async function render(): Promise<void> {
  const my = ++seq;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  searchInput.value = path === '/search' ? params.get('q') ?? '' : '';
  for (const a of document.querySelectorAll<HTMLAnchorElement>('nav a')) {
    a.toggleAttribute('aria-current', raw.startsWith(a.getAttribute('href')!.slice(1)));
  }
  const route = routes.find(([re]) => re.test(path));
  main.setAttribute('aria-busy', 'true');
  let node: Node;
  try {
    node = route ? await route[1](params, decodeURIComponent(path.match(route[0])![1] ?? '')) : notFound();
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    node = msg === 'Not found' ? notFound() : h('div', { class: 'error' }, h('h1', {}, 'Something went wrong'), h('p', {}, msg));
  }
  if (my !== seq) return; // a newer navigation won
  main.replaceChildren(node);
  main.removeAttribute('aria-busy');
  if (!params.has('keep-scroll')) window.scrollTo(0, 0);
}

function notFound(): Node {
  setTitle('Not found');
  return h('div', { class: 'error' }, h('h1', {}, 'Not found'), h('p', {}, h('a', { href: '#/' }, 'Back to the start page')));
}

window.addEventListener('hashchange', render);
render();
