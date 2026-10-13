// Word and line positions from `pdftotext -bbox-layout`, for parsing multi-column lists and tables.

import { execFileSync } from 'node:child_process';

export interface Word { text: string; x0: number; y0: number; x1: number; y1: number }
export interface Line { text: string; x0: number; y0: number; x1: number; y1: number; words: Word[] }
export interface Page { no: number; width: number; height: number; lines: Line[] }

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const num = (attrs: string, k: string) => Number(attrs.match(new RegExp(`${k}="([\\d.]+)"`))![1]);

export function bboxPages(path: string, first: number, last: number): Page[] {
  const xml = execFileSync('pdftotext', ['-bbox-layout', '-f', String(first), '-l', String(last), path, '-'], { maxBuffer: 1 << 28 }).toString('utf8');
  const pages: Page[] = [];
  let no = first;
  for (const pm of xml.matchAll(/<page ([^>]*)>([\s\S]*?)<\/page>/g)) {
    const lines: Line[] = [];
    for (const lm of pm[2].matchAll(/<line ([^>]*)>([\s\S]*?)<\/line>/g)) {
      const words = [...lm[2].matchAll(/<word ([^>]*)>([^<]*)<\/word>/g)].map((w) => ({
        text: decode(w[2]), x0: num(w[1], 'xMin'), y0: num(w[1], 'yMin'), x1: num(w[1], 'xMax'), y1: num(w[1], 'yMax'),
      }));
      if (!words.length) continue;
      lines.push({ text: words.map((w) => w.text).join(' '), x0: num(lm[1], 'xMin'), y0: num(lm[1], 'yMin'), x1: num(lm[1], 'xMax'), y1: num(lm[1], 'yMax'), words });
    }
    pages.push({ no: no++, width: num(pm[1], 'width'), height: num(pm[1], 'height'), lines });
  }
  return pages;
}

// Column starts: x positions (±3 pt) where at least `minLines` lines begin. Right-aligned numbers, margin markers
// and indented continuation lines do not create columns.
export function columnStarts(lines: Line[], minLines = 8): number[] {
  const xs = lines.map((l) => l.x0).sort((a, b) => a - b);
  const starts: number[] = [];
  for (let i = 0; i < xs.length; ) {
    let j = i;
    while (j + 1 < xs.length && xs[j + 1] - xs[i] < 3) j++;
    if (j - i + 1 >= minLines) starts.push(xs[i]);
    i = j + 1;
  }
  return starts;
}

// Lines grouped by column (the last column start at or left of the line), each column read top to bottom.
export function columnOrder(lines: Line[], minLines = 8): Array<{ start: number; lines: Line[] }> {
  const starts = columnStarts(lines, minLines);
  if (!starts.length) return [{ start: Math.min(...lines.map((l) => l.x0)), lines: [...lines].sort((a, b) => a.y0 - b.y0) }];
  const cols = starts.map((start) => ({ start, lines: [] as Line[] }));
  for (const l of lines) {
    let i = starts.length - 1;
    while (i > 0 && l.x0 < starts[i] - 2) i--;
    cols[i].lines.push(l);
  }
  for (const c of cols) c.lines.sort((a, b) => a.y0 - b.y0);
  return cols;
}

// Lines rebuilt from words: pdftotext can merge words of neighbouring columns into one <line> when they share a
// baseline. Words on the same baseline are split into separate segments wherever the gap exceeds `gap` points.
// Column starts (x positions where at least `minLines` lines begin) also split segments, because the gap between
// two columns can be narrower than `gap`.
export function segments(page: Page, gap = 12, minLines = 8): Line[] {
  const words = page.lines.flatMap((l) => l.words).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const startCounts = new Map<number, number>();
  for (const l of page.lines) startCounts.set(Math.round(l.x0), (startCounts.get(Math.round(l.x0)) ?? 0) + 1);
  const colStarts = [...startCounts].filter(([, n]) => n >= minLines).map(([x]) => x);
  const atColStart = (w: Word) => colStarts.some((x) => Math.abs(w.x0 - x) < 2.5);
  const rows: Word[][] = [];
  for (const w of words) {
    const row = rows.find((r) => Math.abs(r[0].y0 - w.y0) < 2.5);
    if (row) row.push(w); else rows.push([w]);
  }
  const out: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    let cur: Word[] = [];
    const flush = () => {
      if (!cur.length) return;
      out.push({ text: cur.map((w) => w.text).join(' '), x0: cur[0].x0, y0: Math.min(...cur.map((w) => w.y0)),
        x1: cur.at(-1)!.x1, y1: Math.max(...cur.map((w) => w.y1)), words: cur });
      cur = [];
    };
    for (const w of row) {
      if (cur.length && (w.x0 - cur.at(-1)!.x1 > gap || atColStart(w))) flush();
      cur.push(w);
    }
    flush();
  }
  return out;
}
