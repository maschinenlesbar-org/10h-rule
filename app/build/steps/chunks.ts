// Step 9: page-aware chunks (~1,500 characters, 200 overlap, never across files) → chunk + FTS5.

import { log, type Ctx } from '../lib/ctx.ts';

const SIZE = 1500, OVERLAP = 200, MIN_PAGE = 400;

export function chunks(ctx: Ctx): void {
  const { db } = ctx;
  const files = db.prepare('SELECT id, doc_id FROM file ORDER BY id').all() as Array<{ id: string; doc_id: string }>;
  const pagesOf = db.prepare('SELECT page_no, text FROM page WHERE file_id = ? ORDER BY page_no');
  const ins = db.prepare('INSERT INTO chunk (file_id, doc_id, page_from, page_to, text) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  for (const f of files) {
    let buf = '', from = 0, to = 0;
    const flush = () => {
      if (buf.trim()) { ins.run(f.id, f.doc_id, from, to, buf.trim()); n++; }
      buf = '';
    };
    for (const p of pagesOf.all(f.id) as Array<{ page_no: number; text: string }>) {
      const text = p.text.replace(/(\w)-\n(\w)/g, '$1$2').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) continue;
      if (!buf) from = p.page_no;
      buf = buf ? `${buf}\n\n${text}` : text;
      to = p.page_no;
      // emit full windows; keep a short tail page in the buffer so it joins the next page
      while (buf.length >= SIZE + OVERLAP) {
        let cut = buf.lastIndexOf(' ', SIZE);
        if (cut < SIZE / 2) cut = SIZE;
        ins.run(f.id, f.doc_id, from, to, buf.slice(0, cut).trim());
        n++;
        buf = buf.slice(Math.max(0, cut - OVERLAP));
        from = to;
      }
      if (buf.length >= MIN_PAGE) flush();
    }
    flush();
  }
  db.exec("INSERT INTO chunk_fts(chunk_fts) VALUES ('rebuild')");
  ctx.report.count('Chunks (full-text index)', n);
  log(`chunks: ${n}`);
}
