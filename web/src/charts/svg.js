// SVG helpers and the shared tooltip. Labels are untrusted data: text only, never innerHTML.

const NS = 'http://www.w3.org/2000/svg';
                                                                       

export function s                                      (tag   , attrs       = {}, ...children                                         )                          {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of children) if (c !== null && c !== undefined) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

// One tooltip for the page. Value first (strong), label second.
let tip                        = null;
export function showTip(target         , value        , label        , extra         )       {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  tip.replaceChildren();
  const v = document.createElement('strong');
  v.textContent = value;
  const l = document.createElement('span');
  l.textContent = label;
  tip.append(v, l);
  if (extra) {
    const x = document.createElement('small');
    x.textContent = extra;
    tip.append(x);
  }
  const r = target.getBoundingClientRect();
  tip.style.display = 'block';
  const w = tip.offsetWidth;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  const top = r.top - tip.offsetHeight - 10;
  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${(top < 8 ? r.bottom + 10 : top) + window.scrollY}px`;
}
export function hideTip()       { if (tip) tip.style.display = 'none'; }

// Wire hover and keyboard focus to the tooltip.
export function withTip                   (el   , value        , label        , extra         )    {
  const on = () => showTip(el, value, label, extra);
  el.addEventListener('pointerenter', on);
  el.addEventListener('focus', on);
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('blur', hideTip);
  return el;
}

export const iso = (d        ) => new Date(`${d.length === 4 ? `${d}-07-01` : d.length === 7 ? `${d}-15` : d}T12:00:00Z`).getTime();
