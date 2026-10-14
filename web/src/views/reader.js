import { api } from '../api.js?v=e7a98de609';
import { h, setTitle, entityLink, readerHref, entityHref, typeLabel, fileUrl, fmtBytes, narrow } from '../dom.js?v=e7a98de609';
                                            

export async function readerView(params                 )                {
  const file = params.get('file') ?? '';
  const n = Number(params.get('n')) || 1;
  const q = params.get('q') ?? '';
  const v = await api.page(file, n);
  setTitle(`${v.doc.label}, p. ${n}`);
  const go = (page        ) => readerHref(file, page, q ? { q } : {});
  const size = fmtBytes(v.files.find((f) => f.id === file)?.bytes);
  const pdfAt = `${fileUrl(file)}#page=${n}`;

  const nav = h('nav', { class: 'pager', 'aria-label': 'Pages' },
    n > 1 ? h('a', { href: go(n - 1), rel: 'prev' }, '← Previous') : h('span', { class: 'muted' }, '← Previous'),
    h('form', { onsubmit: (e       ) => {
      e.preventDefault();
      const to = Number(((e.target                   ).elements.namedItem('n')                    ).value);
      if (to >= 1 && to <= v.pages) location.hash = go(to);
    } }, 'Page ', h('input', { name: 'n', type: 'number', min: 1, max: v.pages, value: n, 'aria-label': 'Page number' }), ` of ${v.pages}`),
    n < v.pages ? h('a', { href: go(n + 1), rel: 'next' }, 'Next →') : h('span', { class: 'muted' }, 'Next →'));

  return h('div', { class: 'reader' },
    h('header', { class: 'reader-head' },
      h('p', { class: 'eyebrow' }, 'Document reader'),
      h('h1', {}, h('a', { href: entityHref(v.doc.id) }, v.doc.label)),
      v.files.length > 1 ? h('ul', { class: 'tabs' }, ...v.files.map((f) => h('li', {},
        h('a', { href: readerHref(f.id, 1), 'aria-current': f.id === file ? 'page' : null }, f.part ?? f.id.split('/').pop() )))) : null,
      h('div', { class: 'reader-bar' }, nav,
        v.read_via === 'ocr' ? h('span', { class: 'badge marker-unverified', title: 'This page has no text layer; the text was read by OCR and can contain errors.' }, 'OCR text') : null,
        h('a', { href: pdfAt, target: '_blank' }, 'Open PDF at this page', size ? ` (${size})` : ''))),
    h('div', { class: 'reader-body' },
      h('section', { class: 'page-text', 'aria-label': 'Extracted text' }, renderText(v, q)),
      h('section', { class: 'page-pdf', 'aria-label': 'Original PDF' },
        narrow()
          ? h('p', { class: 'pdf-link' }, h('a', { href: pdfAt, target: '_blank', class: 'button' }, `Open the PDF at page ${n}`), size ? h('span', { class: 'muted small' }, ` ${size}`) : null)
          : h('iframe', { src: `${pdfAt}&view=FitH`, title: `PDF ${v.doc.label}, page ${n}`, loading: 'lazy' }))),
    legend(v),
    similarPassages(file, n));
}

function similarPassages(file        , n        )       {
  const box = h('section', { class: 'similar' });
  api.similarPassages(file, n).then((list) => {
    if (!list.length) return;
    box.append(h('h2', {}, 'Similar passages in other documents'),
      h('ol', { class: 'similar-passages' }, ...list.map((p) => h('li', {},
        h('a', { href: readerHref(p.file_id, p.page_from) }, `${p.doc.label}, p. ${p.page_from}`),
        h('p', { class: 'passage' }, p.excerpt)))));
  }).catch(() => {});
  return box;
}

// Page text with entity spans as links, and query terms marked.
function renderText(v          , q        )       {
  const pre = h('div', { class: 'text' });
  const terms = q.split(/\s+/).map((t) => t.replace(/[*"]/g, '')).filter((t) => t.length > 1);
  const termRe = terms.length ? new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  const withTerms = (s        )         => {
    if (!termRe) return [document.createTextNode(s)];
    return s.split(termRe).map((part, i) => (i % 2 ? h('mark', {}, part) : document.createTextNode(part)));
  };
  let pos = 0;
  for (const s of v.spans) {
    if (s.start < pos) continue;
    pre.append(...withTerms(v.text.slice(pos, s.start)));
    const a = entityLink(s.entity, `span ${s.kind} ${s.status}`);
    a.textContent = v.text.slice(s.start, s.end);
    a.title = `${typeLabel(s.entity.type)}: ${s.entity.label}${s.status === 'auto' ? ' (unreviewed)' : ''}`;
    pre.append(a);
    pos = s.end;
  }
  pre.append(...withTerms(v.text.slice(pos)));
  return pre;
}

function legend(v          )              {
  if (!v.spans.length) return null;
  const seen = new Map                                                          ();
  for (const s of v.spans) seen.set(s.entity.id, { e: s.entity, n: (seen.get(s.entity.id)?.n ?? 0) + 1 });
  return h('section', { class: 'on-this-page' },
    h('h2', {}, 'On this page'),
    h('ul', { class: 'chips' }, ...[...seen.values()].sort((a, b) => b.n - a.n).map(({ e, n }) =>
      h('li', {}, entityLink(e), n > 1 ? h('span', { class: 'count' }, String(n)) : null))));
}
