import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
export const APP = join(here, '..', '..');
export const REPO = join(APP, '..');
export const WIKI = join(REPO, '10h-wiki');
export const DATA = join(APP, 'data');
export const OUT = join(APP, 'out');
export const CACHE = join(APP, '.cache');

export interface Ctx {
  db: DatabaseSync;
  opts: { ocr: boolean; network: boolean; refreshWikidata: boolean; embed: boolean };
  report: Report;
  failures?: number; // hard failures found by steps before the checks
}

// Collects findings for out/report.md. Sections keep insertion order.
export class Report {
  sections = new Map<string, string[]>();
  counts = new Map<string, number>();
  add(section: string, line: string): void {
    if (!this.sections.has(section)) this.sections.set(section, []);
    this.sections.get(section)!.push(line);
  }
  count(key: string, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
  }
  toMarkdown(title: string): string {
    const out = [`# ${title}`, ''];
    if (this.counts.size) {
      out.push('| Item | Count |', '| --- | ---: |');
      for (const [k, v] of this.counts) out.push(`| ${k} | ${v} |`);
      out.push('');
    }
    for (const [s, lines] of this.sections) {
      out.push(`## ${s} (${lines.length})`, '');
      const shown = lines.slice(0, 200);
      out.push(...shown.map((l) => `- ${l}`));
      if (lines.length > shown.length) out.push(`- … ${lines.length - shown.length} more`);
      out.push('');
    }
    return out.join('\n');
  }
}

export const log = (...a: unknown[]) => console.error('[build]', ...a);
