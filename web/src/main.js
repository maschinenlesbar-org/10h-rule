// Hash router. Routes: #/ · #/search?q= · #/e/<entity id> · #/read?file=&n= · #/list/<kind> · #/bibliography · #/about · #/review
import { h, setTitle } from './dom.js?v=e7a98de609';
import { isStatic, dbProgress, prefetchDb } from './api.js?v=e7a98de609';
import { home } from './views/home.js?v=e7a98de609';
import { searchView } from './views/search.js?v=e7a98de609';
import { entityView } from './views/entity.js?v=e7a98de609';
import { readerView } from './views/reader.js?v=e7a98de609';
import { listView } from './views/lists.js?v=e7a98de609';
import { reviewView } from './views/review.js?v=e7a98de609';
import { storyView } from './views/story.js?v=e7a98de609';
import { questionsView } from './views/questions.js?v=e7a98de609';
import { effectsView } from './views/effects.js?v=e7a98de609';
import { laenderView } from './views/laender.js?v=e7a98de609';
import { aboutView } from './views/about.js?v=e7a98de609';
import { bibliographyView } from './views/bibliography.js?v=e7a98de609';

const main = document.querySelector('main') ;
const searchForm = document.querySelector                 ('#top-search') ;
const searchInput = searchForm.querySelector('input') ;
const browse = document.querySelector                    ('details.browse') ;

// The published site is read-only: the review list is a local tool.
if (isStatic) for (const a of document.querySelectorAll('[data-local-only]')) a.remove();
document.addEventListener('click', (e) => { if (!browse.contains(e.target        )) browse.open = false; });
browse.addEventListener('keydown', (e) => { if (e.key === 'Escape') { browse.open = false; browse.querySelector('summary') .focus(); } });

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (q) location.hash = `#/search?${new URLSearchParams({ q })}`;
});

                                                                     
const routes                        = [
  [/^\/?$/, home],
  [/^\/story$/, storyView],
  [/^\/questions$/, questionsView],
  [/^\/effects$/, effectsView],
  [/^\/laender$/, laenderView],
  [/^\/search$/, searchView],
  [/^\/e\/(.+)$/, entityView],
  [/^\/read$/, readerView],
  [/^\/list\/([a-z]+)$/, listView],
  [/^\/bibliography$/, bibliographyView],
  [/^\/about$/, aboutView],
  [/^\/review$/, reviewView],
];

let seq = 0, first = true;
async function render()                {
  const my = ++seq;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  searchInput.value = path === '/search' ? params.get('q') ?? '' : '';
  for (const a of document.querySelectorAll                   ('nav a')) {
    a.toggleAttribute('aria-current', raw.startsWith(a.getAttribute('href') .slice(1)));
  }
  browse.open = false;
  browse.querySelector('summary') .toggleAttribute('aria-current', !!browse.querySelector('a[aria-current]'));
  const route = routes.find(([re]) => re.test(path));
  main.setAttribute('aria-busy', 'true');
  // A view that waits for the database on the first visit says so, with the download progress.
  const slow = window.setTimeout(() => { if (my === seq) main.replaceChildren(loading()); }, 250);
  let node      ;
  try {
    node = route ? await route[1](params, decodeURIComponent(path.match(route[0]) [1] ?? '')) : notFound();
  } catch (err) {
    const msg = String((err         ).message ?? err);
    node = msg === 'Not found' ? notFound() : h('div', { class: 'error' }, h('h1', {}, 'Something went wrong'), h('p', {}, msg));
  }
  clearTimeout(slow);
  if (my !== seq) return; // a newer navigation won
  main.replaceChildren(node);
  main.removeAttribute('aria-busy');
  if (!params.has('keep-scroll')) window.scrollTo(0, 0);
  if (first) { first = false; prefetchDb(); }
}

function loading()       {
  if (!isStatic || dbProgress.done) return h('p', { class: 'loading' }, 'Loading…');
  const mb = (n        ) => (n / 1e6).toFixed(0);
  const bar = h('progress', { max: dbProgress.total || 1, value: dbProgress.loaded, 'aria-label': 'Database download' });
  const text = h('p', { class: 'muted small' });
  const update = () => {
    bar.value = dbProgress.loaded;
    text.textContent = dbProgress.loaded >= dbProgress.total
      ? 'Opening the database…'
      : `${mb(dbProgress.loaded)} of ${mb(dbProgress.total)} MB. Only on the first visit; later visits use the browser cache.`;
  };
  dbProgress.listeners.add(update);
  update();
  return h('div', { class: 'loading' },
    h('h1', {}, 'Loading the archive'),
    h('p', {}, 'The whole database runs in your browser: every page of text, every fact and its source.'),
    bar, text);
}

function notFound()       {
  setTitle('Not found');
  return h('div', { class: 'error' }, h('h1', {}, 'Not found'), h('p', {}, h('a', { href: '#/' }, 'Back to the start page')));
}

window.addEventListener('hashchange', render);
render();
