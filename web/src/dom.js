// Tiny DOM helpers. All text goes through text nodes, never innerHTML: document text is untrusted (OCR, PDFs).

                                                                         
                                                                                          

export function h                                       (tag   , attrs        = {}, ...children         )                           {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v                 );
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el      , children         )       {
  for (const c of children.flat(Infinity     )           ) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function frag(...children         )                   {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

// Snippets from the API mark matches with \u0002 … \u0003.
export function marked(s        )                   {
  const f = document.createDocumentFragment();
  for (const [i, part] of s.split(/[\u0002\u0003]/).entries()) {
    if (!part) continue;
    f.appendChild(i % 2 ? h('mark', {}, part) : document.createTextNode(part));
  }
  return f;
}

export const fmtDate = (iso                           )         => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d ? `${d}.${m}.${y}` : m ? `${m}/${y}` : y;
};

export const entityHref = (id        ) => `#/e/${id}`;
export const readerHref = (file        , page        , extra                         = {}) =>
  `#/read?${new URLSearchParams({ file, n: String(page), ...extra })}`;

const TYPE_LABEL                         = { Person: 'Person', Organization: 'Organisation', Document: 'Document', Law: 'Law', Concept: 'Concept',
  Place: 'Place', Event: 'Event', VoteEvent: 'Roll call', Procedure: 'Procedure' };
export const typeLabel = (t        ) => TYPE_LABEL[t] ?? t;

export function entityLink(e                                             , extra = '')                    {
  return h('a', { href: entityHref(e.id), class: `ent ent-${e.type.toLowerCase()} ${extra}`.trim(), title: typeLabel(e.type) }, e.label);
}

// Only http(s) addresses become links (defence in depth: the build already filters them).
export const safeUrl = (u                           )                => (u && /^https?:\/\//i.test(u) ? u : null);
// Rel for links to third-party sites, many taken from documents written years ago.
export const EXTERNAL_REL = 'noopener noreferrer nofollow';

export function badge(text        , kind = '')                  {
  return h('span', { class: `badge ${kind}`.trim() }, text);
}

export function markerBadge(marker        )                         {
  if (marker === 'primary') return null;
  return badge(marker === 'secondary' ? 'secondary' : 'not verified', `marker-${marker}`);
}

export function setTitle(t        )       { document.title = t ? `${t} · 10H Explorer` : '10H Explorer'; }

// Archived file URL, relative to the page; each path segment encoded so static hosts see real folders.
export const fileUrl = (id        )         => `files/${id.split('/').map(encodeURIComponent).join('/')}`;

export const fmtBytes = (n                           )         =>
  !n ? '' : n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

// Phones and narrow windows: embedded PDFs render badly or not at all in mobile browsers.
export const narrow = ()          => window.matchMedia('(max-width: 760px)').matches;
