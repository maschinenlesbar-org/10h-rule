import { api } from '../api.js?v=e7a98de609';
import { h, setTitle, entityLink, fmtDate, readerHref, typeLabel, badge, markerBadge, entityHref, fileUrl, fmtBytes, safeUrl, EXTERNAL_REL } from '../dom.js?v=e7a98de609';
import { isStatic } from '../api.js?v=e7a98de609';
import { groupFacts } from '../facts.js?v=e7a98de609';
import { personFacts, dipRoles, activityText, questionsText, electedText, fractionText, roleLabel, storyYears } from '../profile.js?v=e7a98de609';
                                                              
import { rollcallSection } from '../charts/rollcall.js?v=e7a98de609';

const ARENA                         = { bt: 'Bundestag', br: 'Bundesrat', by: 'Bayern', sn: 'Sachsen', bund: 'Bund', 'bund-government': 'Bundesregierung' };
const COLLAPSE_AT = 12;

export async function entityView(_p                 , id        )                {
  const e = await api.entity(id);
  setTitle(e.entity.label);
  return h('div', { class: 'entity' },
    header(e),
    e.profile ? profilePanel(e) : null,
    e.document ? documentPanel(e) : null,
    e.entity.type === 'Event' ? eventPanel(e) : null,
    e.procedure ? procedurePanel(e) : null,
    e.rollcall ? rollcallSection(e.rollcall) : null,
    factsSection(e),
    worksSection(e),
    mentionsSection(e),
    e.document ? similarSection(e.entity.id) : null);
}

// "More like this": loaded after the page, so a missing table never blocks it.
function similarSection(docId        )       {
  const box = h('section', { class: 'similar' });
  api.similarDocs(docId).then((list) => {
    if (!list.length) return;
    box.append(h('h2', {}, 'Similar documents'),
      h('p', { class: 'muted small' }, 'By meaning, compared over the whole text. Useful for finding related answers and protocols.'),
      h('ul', { class: 'mention-list' }, ...list.map((s) => h('li', {}, entityLink(s.doc),
        h('span', { class: 'muted small' }, ` ${[s.doc.kind, fmtDate(s.doc.date)].filter(Boolean).join(' · ')}`)))));
  }).catch(() => {});
  return box;
}

function header(e            )       {
  const props = e.entity.props                       ;
  return h('header', { class: 'entity-head' },
    h('p', { class: 'eyebrow' }, typeLabel(e.entity.type), props.classification ? ` · ${props.classification.replace(/_/g, ' ')}` : ''),
    h('h1', {}, e.entity.label),
    e.aliases.length ? h('p', { class: 'muted small' }, 'Also: ', e.aliases.slice(0, 12).join(' · ')) : null,
    props.description ? h('p', {}, props.description) : null,
    e.external.length || props.profile ? h('p', { class: 'ids' },
      ...e.external.map((x) => safeUrl(x.url)
        ? h('a', { href: safeUrl(x.url), target: '_blank', rel: EXTERNAL_REL, class: 'id-chip' }, `${x.scheme} ${x.value}`, x.status !== 'confirmed' ? ' (unverified)' : '')
        : h('span', { class: 'id-chip' }, `${x.scheme} ${x.value}`)),
      props.profile ? h('span', { class: 'id-chip' }, `wiki: ${props.profile}`) : null) : null,
    // The static page of this entity: a plain URL that search engines index and link previews can read.
    isStatic ? h('p', { class: 'small' }, h('a', { href: `e/${e.entity.id}/`, class: 'permalink' }, 'Permanent link')) : null);
}

// abgeordnetenwatch.de and DIP: personal data, mandates with Fraktion, election and committees, offices, activity.
function profilePanel(e            )       {
  const p = e.profile , a = p.abgeordnetenwatch;
  const facts = personFacts(p), roles = dipRoles(p), activity = activityText(p), questions = questionsText(p);
  const years = storyYears(p);
  return h('section', { class: 'profile' },
    facts.length ? h('dl', { class: 'meta-grid' }, ...facts.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
    roles.length ? [h('h2', {}, 'Offices and roles (DIP)'), h('ul', { class: 'plain-list' }, ...roles.map((r) => h('li', {}, r)))] : null,
    a?.mandates.length ? [
      h('h2', {}, 'Mandates', h('span', { class: 'count' }, String(a.mandates.length))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'mandates' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Parliament'), h('th', { scope: 'col' }, 'Fraktion'), h('th', { scope: 'col' }, 'Elected'),
          h('th', { scope: 'col' }, `Committees (periods ${years})`))),
        h('tbody', {}, ...a.mandates.map((m) => h('tr', {},
          h('th', { scope: 'row' }, m.period), h('td', { 'data-label': 'Fraktion' }, fractionText(m)), h('td', { 'data-label': 'Elected' }, electedText(m)),
          h('td', { 'data-label': 'Committees' }, m.committees === null ? h('span', { class: 'muted' }, '–')
            : m.committees.length ? h('ul', { class: 'plain-list' }, ...m.committees.map((c) => h('li', {}, c.committee, h('span', { class: 'muted small' }, ` · ${roleLabel(c.role)}`))))
            : h('span', { class: 'muted' }, 'none')))))))] : null,
    activity || questions ? [h('h2', {}, 'Activity'), h('ul', { class: 'plain-list' },
      activity ? h('li', {}, `In DIP, ${years}: ${activity}.`) : null,
      questions ? h('li', {}, `${questions}.`) : null)] : null,
    h('p', { class: 'muted small source-note' }, 'From ',
      a?.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, 'abgeordnetenwatch.de') : 'abgeordnetenwatch.de', ' (CC0)',
      p.dip ? [' and ', h('a', { href: `https://dip.bundestag.de/person/${e.entity.id.replace(/^person\//, '')}/${p.dip.id}`, target: '_blank', rel: 'noopener noreferrer' }, 'DIP'), ' (Deutscher Bundestag)'] : null,
      p.fetched ? `, as of ${p.fetched.split('-').reverse().join('.')}` : '', '. Committees only for parliament periods that overlap the story.'));
}

function documentPanel(e            )       {
  const d = e.document ;
  const row = (k        , v                                  ) => v ? [h('dt', {}, k), h('dd', {}, v)] : [];
  return h('section', { class: 'doc-panel' },
    h('dl', { class: 'meta-grid' },
      ...row('Type', d.kind), ...row('Number', d.number), ...row('Date', fmtDate(d.date)), ...row('Issuer', d.issuer),
      ...row('Title', d.title),
      ...row('Source', sourceLink(d.source_url))),
    d.archived
      ? h('ul', { class: 'files' }, ...d.files.map((f) => h('li', {},
          h('a', { href: readerHref(f.id, 1), class: 'button' }, `Read${f.part ? ` (${f.part})` : ''}`), ' ',
          h('a', { href: `${fileUrl(f.id)}`, target: '_blank' }, 'PDF'),
          h('span', { class: 'muted small' }, ` ${[`${f.pages} pages`, fmtBytes(f.bytes), f.id].filter(Boolean).join(' · ')}`))))
      : h('p', { class: 'muted' }, 'Not in the archive. Cited by archived documents; the source link opens the original.'));
}

// The source link shows the host; an address that does not parse is shown as text, not as a broken page.
function sourceLink(u               )              {
  const url = safeUrl(u);
  if (!url) return u ? document.createTextNode(u) : null;
  let host = url;
  try { host = new URL(url).host; } catch { /* keep the address */ }
  return h('a', { href: url, target: '_blank', rel: EXTERNAL_REL }, host);
}

function eventPanel(e            )       {
  const p = e.entity.props                       ;
  return h('section', { class: 'doc-panel' },
    h('dl', { class: 'meta-grid' },
      h('dt', {}, 'Date'), h('dd', {}, fmtDate(p.date), p.end ? `–${fmtDate(p.end)}` : ''),
      h('dt', {}, 'Arena'), h('dd', {}, ARENA[p.arena] ?? p.arena),
      p.body ? [h('dt', {}, 'Body'), h('dd', {}, p.body)] : null),
    h('p', {}, p.text),
    h('p', { class: 'muted small' }, `From ${(p.pages ?? []).join(', ')}`));
}

function procedurePanel(e            )       {
  const p = e.procedure ;
  return h('section', { class: 'procedure' },
    h('dl', { class: 'meta-grid' },
      h('dt', {}, 'Period'), h('dd', {}, `${fmtDate(p.start)} – ${p.end ? fmtDate(p.end) : 'open'}`),
      h('dt', {}, 'Status'), h('dd', {}, p.status)),
    h('h2', {}, 'Steps'),
    h('ol', { class: 'steps' }, ...p.steps.map((st) => h('li', {},
      h('span', { class: 'step-date' }, fmtDate(st.date), st.end ? `–${fmtDate(st.end)}` : ''),
      h('div', { class: 'step-body' },
        st.body ? badge(st.body, 'arena') : null, ' ',
        st.event ? h('a', { href: entityHref(st.event.id) }, st.text) : st.text,
        st.docs.length ? h('div', { class: 'chips step-docs' }, ...st.docs.map((d) => entityLink(d))) : null)))),
    p.otherDocs.length ? [h('h3', {}, 'Other documents of this procedure'),
      h('ul', { class: 'chips' }, ...p.otherDocs.map((d) => h('li', {}, entityLink(d))))] : null);
}

function evidenceChip(ev          )              {
  if (!ev.doc_id) return null;
  const label = `${ev.doc_label ?? ev.doc_id}${ev.page ? `, p. ${ev.page}` : ev.locator ? `, ${ev.locator}` : ''}`;
  const href = ev.file_id && ev.page ? readerHref(ev.file_id, ev.page, ev.quote ? { q: ev.quote } : {}) : entityHref(ev.doc_id);
  return h('a', { class: `evidence${ev.read_via === 'ocr' ? ' ocr' : ''}`, href, title: ev.quote ? `“${ev.quote}”` : 'Source document' },
    label, ev.read_via === 'ocr' ? ' · OCR' : '');
}

function factRow(f      )       {
  const date = f.start ? fmtDate(f.start) + (f.end ? `–${fmtDate(f.end)}` : '') : '';
  return h('li', { class: `fact${f.interpretive ? ' interpretive' : ''}` },
    h('div', { class: 'fact-main' },
      f.other ? entityLink(f.other) : null,
      f.value ? h('span', { class: 'value' }, f.other ? ` · ${f.value}` : f.value) : null,
      date ? h('span', { class: 'date' }, date) : null,
      markerBadge(f.marker),
      f.interpretive ? badge('interpretation', 'interpretive') : null),
    f.rationale ? h('p', { class: 'rationale' }, f.rationale) : null,
    f.evidence.length || f.source ? h('div', { class: 'fact-evidence' },
      // A chip that only repeats the linked document (no page, no quote) adds nothing.
      ...f.evidence.filter((ev) => ev.page || ev.quote || ev.doc_id !== f.other?.id).slice(0, 3).map(evidenceChip),
      f.evidence.length > 3 ? h('span', { class: 'muted small' }, ` +${f.evidence.length - 3} more`) : null,
      f.source && f.method !== 'regex' ? h('span', { class: 'source', title: `Read by the ${f.method} step` }, f.source) : null) : null);
}

function factsSection(e            )              {
  // On a procedure page, its parts are already shown as steps and documents.
  const facts = e.procedure ? e.facts.filter((f) => !(f.pred === 'part_of' && f.direction === 'in')) : e.facts;
  if (!facts.length) return null;
  return h('section', { class: 'facts' },
    h('h2', {}, 'Facts and links'),
    ...groupFacts(facts).map(({ label, facts }) => {
      const list = h('ul', { class: 'fact-list' }, ...facts.slice(0, COLLAPSE_AT).map(factRow));
      const more = facts.length > COLLAPSE_AT ? h('button', { type: 'button', class: 'link-button', onclick: (ev       ) => {
        for (const f of facts.slice(COLLAPSE_AT)) list.appendChild(factRow(f));
        (ev.target               ).remove();
      } }, `Show all ${facts.length}`) : null;
      return h('div', { class: 'fact-group' }, h('h3', {}, label, h('span', { class: 'count' }, String(facts.length))), list, more);
    }));
}

// Court decisions, legislation, literature and web sources this document cites (bibliography step).
function worksSection(e            )              {
  if (!e.works?.length) return null;
  return h('section', { class: 'works' },
    h('h2', {}, 'Works cited', h('span', { class: 'count' }, String(e.works.length))),
    h('p', { class: 'muted small' }, 'Outside the archive, found by pattern in the text. ', h('a', { href: '#/bibliography' }, 'The whole bibliography')),
    h('ul', { class: 'fact-list' }, ...e.works.map((w) => h('li', { class: 'fact' },
      safeUrl(w.url) ? h('a', { href: safeUrl(w.url), target: '_blank', rel: EXTERNAL_REL, title: WEB_NOTE }, w.label) : w.label,
      h('span', { class: 'badge' }, KIND_LABEL[w.kind]),
      h('div', { class: 'fact-evidence' }, ...w.pages.map((n) => h('a', { class: 'evidence', href: readerHref(w.file_id, n) }, `p. ${n}`)))))));
}
const WEB_NOTE = 'Address as given in the document; the page may have moved or changed owner since.';
const KIND_LABEL                         = { court: 'court decision', legislation: 'legislation', literature: 'literature', web: 'web', parliamentary: 'parliamentary' };

function mentionsSection(e            )              {
  if (!e.mentionedIn.length) return null;
  return h('section', { class: 'mentions' },
    h('h2', {}, 'Mentioned in', h('span', { class: 'count' }, `${e.mentionTotal} mentions`)),
    e.mentionedIn.some((m) => m.status === 'auto') ? h('p', { class: 'muted small' }, 'Mentions marked “unreviewed” were found by the dictionary and are not yet checked.') : null,
    h('ul', { class: 'mention-list' }, ...e.mentionedIn.map((m) => h('li', {},
      entityLink(m.doc), h('span', { class: 'count' }, String(m.n)), m.status === 'auto' ? badge('unreviewed', 'marker-unverified') : null))));
}
