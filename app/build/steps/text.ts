// Step 2: page text per file. Text layer via pdftotext; pages without one are OCRed (tesseract -l deu).
// Results are cached by SHA-256 in .cache/text, so OCR runs once per file version.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WIKI, CACHE, log, type Ctx } from '../lib/ctx.ts';

const run = promisify(execFile);
const MIN_CHARS = 80; // fewer non-space characters than this on a page means "no usable text layer"
const OCR_VERSION = 'tesseract-deu-300dpi-v1'; // bump to invalidate cached OCR

interface CachedPage { text: string; readVia: 'text_layer' | 'ocr' | 'none' }
interface Cached { version: string; pages: CachedPage[] }

async function textLayer(path: string): Promise<string[]> {
  if (path.endsWith('.docx')) {
    const { stdout } = await run('textutil', ['-convert', 'txt', '-stdout', path], { maxBuffer: 1 << 28 });
    return [stdout];
  }
  const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', path, '-'], { maxBuffer: 1 << 28 });
  const pages = stdout.split('\f');
  if (pages.length > 1 && pages.at(-1)!.trim() === '') pages.pop();
  return pages;
}

async function ocrPage(path: string, page: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), '10h-ocr-'));
  try {
    await run('pdftoppm', ['-r', '300', '-gray', '-png', '-f', String(page), '-l', String(page), path, join(dir, 'p')]);
    const png = readdirSync(dir).find((f) => f.endsWith('.png'));
    if (!png) return '';
    const { stdout } = await run('tesseract', [join(dir, png), 'stdout', '-l', 'deu'], { maxBuffer: 1 << 26 });
    return stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await f(queue.shift()!); }));
}

export async function extractText(ctx: Ctx): Promise<void> {
  const { db, report, opts } = ctx;
  mkdirSync(join(CACHE, 'text'), { recursive: true });
  const files = db.prepare('SELECT id, sha256 FROM file ORDER BY id').all() as Array<{ id: string; sha256: string }>;
  const insPage = db.prepare('INSERT INTO page (file_id, page_no, text, read_via) VALUES (?, ?, ?, ?)');
  const setPages = db.prepare('UPDATE file SET pages = ? WHERE id = ?');
  let ocrPages = 0, cached = 0;

  await pool(files, 4, async (f) => {
    const cacheFile = join(CACHE, 'text', `${f.sha256}.json`);
    let data: Cached | null = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : null;
    if (data && data.version !== OCR_VERSION && data.pages.some((p) => p.readVia === 'ocr')) data = null;
    if (data && opts.ocr && data.pages.some((p) => p.readVia === 'none')) data = null; // retry pages skipped without OCR
    if (data) { cached++; }
    else {
      const path = join(WIKI, f.id);
      const layer = await textLayer(path);
      const pages: CachedPage[] = [];
      for (let i = 0; i < layer.length; i++) {
        const t = layer[i];
        if (t.replace(/\s/g, '').length >= MIN_CHARS || f.id.endsWith('.docx')) { pages.push({ text: t, readVia: 'text_layer' }); continue; }
        if (!opts.ocr) { pages.push({ text: t, readVia: 'none' }); continue; }
        const o = await ocrPage(path, i + 1);
        ocrPages++;
        pages.push(o.replace(/\s/g, '').length > t.replace(/\s/g, '').length ? { text: o, readVia: 'ocr' } : { text: t, readVia: 'text_layer' });
      }
      data = { version: OCR_VERSION, pages };
      writeFileSync(cacheFile, JSON.stringify(data));
    }
    data.pages.forEach((p, i) => insPage.run(f.id, i + 1, p.text, p.readVia));
    setPages.run(data.pages.length, f.id);
  });

  const stats = db.prepare('SELECT read_via, count(*) n FROM page GROUP BY read_via').all() as Array<{ read_via: string; n: number }>;
  for (const s of stats) report.count(`Pages read via ${s.read_via}`, s.n);
  const empty = db.prepare("SELECT file_id, page_no FROM page WHERE length(trim(text)) < 20").all() as Array<{ file_id: string; page_no: number }>;
  for (const e of empty) report.add('Pages without text (blank or unreadable)', `${e.file_id} p. ${e.page_no}`);
  log(`text: ${files.length} files (${cached} from cache), ${ocrPages} pages OCRed now`);
}
