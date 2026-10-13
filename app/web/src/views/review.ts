import { api } from '../api.ts';
import { h, setTitle, entityLink, marked, readerHref, badge, typeLabel } from '../dom.ts';
import type { ReviewGroup } from '../types.ts';

const TYPES = ['', 'Concept', 'Place', 'Organization'];
const STATUSES = ['auto', 'confirmed', 'rejected'];

export async function reviewView(params: URLSearchParams): Promise<Node> {
  const type = params.get('type') ?? '';
  const status = params.get('status') ?? 'auto';
  setTitle('Review mentions');
  const [meta, groups] = await Promise.all([api.meta(), api.review(type, status)]);
  const link = (k: string, v: string, label: string, current: string) => {
    const p = new URLSearchParams(params);
    p.set(k, v);
    return h('a', { href: `#/review?${p}`, 'aria-current': v === current ? 'true' : null }, label);
  };
  return h('div', { class: 'review' },
    h('h1', {}, 'Review mentions'),
    h('p', {},
      'Organisations, places and concepts are linked by dictionary and can be wrong (“Schwaben” the region or the people, “Main” the river). ',
      'A decision applies to one entity and one surface form everywhere. Only confirmed mentions will become “about” links.'),
    meta.reviewWritable
      ? h('p', { class: 'notice' }, 'Review mode: decisions are saved to the database and to data/mention-review.csv, so the next build keeps them.')
      : h('p', { class: 'notice' }, 'Read-only. Start the server with ', h('code', {}, 'npm run serve:review'), ' to record decisions.'),
    h('nav', { class: 'filters' },
      h('span', {}, 'Type: ', ...TYPES.flatMap((t, i) => [i ? ' · ' : '', link('type', t, t ? typeLabel(t) : 'all', type)])),
      h('span', {}, 'Status: ', ...STATUSES.flatMap((s, i) => [i ? ' · ' : '', link('status', s, s === 'auto' ? 'open' : s, status)]))),
    groups.length ? h('ol', { class: 'review-list' }, ...groups.map((g) => group(g, meta.reviewWritable))) : h('p', { class: 'muted' }, 'Nothing here.'));
}

function group(g: ReviewGroup, writable: boolean): Node {
  const state = badge(g.status === 'auto' ? 'open' : g.status, `status-${g.status}`);
  const decide = (status: string) => async (ev: Event) => {
    const btn = ev.target as HTMLButtonElement;
    btn.disabled = true;
    try {
      const r = await api.setReview(g.entity.id, g.surface, status);
      state.textContent = `${status === 'auto' ? 'open' : status} (${r.changed})`;
      state.className = `badge status-${status}`;
    } catch (err) {
      state.textContent = String((err as Error).message);
    } finally {
      btn.disabled = false;
    }
  };
  return h('li', { class: 'review-group' },
    h('div', { class: 'review-head' },
      h('strong', {}, `“${g.surface}”`), ' → ', entityLink(g.entity), h('span', { class: 'count' }, `${g.n}×`), state,
      writable ? h('span', { class: 'actions' },
        h('button', { type: 'button', onclick: decide('confirmed') }, 'Confirm'),
        h('button', { type: 'button', onclick: decide('rejected') }, 'Reject'),
        g.status !== 'auto' ? h('button', { type: 'button', class: 'link-button', onclick: decide('auto') }, 'Reopen') : null) : null),
    h('ul', { class: 'samples' }, ...g.samples.map((s) => h('li', {},
      h('a', { href: readerHref(s.file_id, s.page_from, { q: g.surface }), class: 'page-link' }, `${s.doc_id.replace(/^doc\//, '')}, p. ${s.page_from}`),
      ' …', marked(s.context), '…'))));
}
