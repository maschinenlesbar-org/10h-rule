// Build pipeline: node build/index.ts [--no-ocr] [--offline] [--refresh-wikidata] [--no-embed]
// Writes out/10h.db and out/report.md. See CONCEPT.md, section 5.

import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { OUT, Report, log, type Ctx } from './lib/ctx.ts';
import { openFresh } from './lib/db.ts';
import { inventory } from './steps/inventory.ts';
import { extractText } from './steps/text.ts';
import { seed } from './steps/seed.ts';
import { wiki } from './steps/wiki.ts';
import { wikidata } from './steps/wikidata.ts';
import { references } from './steps/references.ts';
import { bibliography } from './steps/bibliography.ts';
import { chunks } from './steps/chunks.ts';
import { mentions } from './steps/mentions.ts';
import { checks } from './steps/checks.ts';
import { votes } from './steps/votes.ts';
import { procedures } from './steps/procedures.ts';
import { embedChunks } from './steps/embed.ts';
import { answers } from './steps/answers.ts';
import { observations } from './steps/observations.ts';
import { about } from './steps/about.ts';
import { profiles } from './steps/profiles.ts';

const args = new Set(process.argv.slice(2));
mkdirSync(OUT, { recursive: true });
const tmp = join(OUT, '10h.db.tmp');
const ctx: Ctx = {
  db: openFresh(tmp),
  opts: { ocr: !args.has('--no-ocr'), network: !args.has('--offline'), refreshWikidata: args.has('--refresh-wikidata'), embed: !args.has('--no-embed') },
  report: new Report(),
};

const steps: Array<[string, (c: Ctx) => unknown]> = [
  ['1 inventory', inventory],
  ['2 text', extractText],
  ['3 seed', seed],
  ['4 wiki', wiki],
  ['3a wikidata', wikidata],
  ['4b answers', answers],
  ['4c profiles', profiles],
  ['7 votes', votes],
  ['8 procedures', procedures],
  ['8b observations', observations],
  ['5 references', references],
  ['5b bibliography', bibliography],
  ['9 chunks', chunks],
  ['6 mentions', mentions],
  ['6b about', about],
  ['10 embed', embedChunks],
];

const t0 = Date.now();
for (const [name, step] of steps) {
  const t = Date.now();
  await step(ctx);
  log(`${name} done in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
const failures = checks(ctx) + (ctx.failures ?? 0);

const meta = ctx.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
meta.run('built_at', new Date().toISOString());
meta.run('phase', '5');
meta.run('embed_model', ctx.opts.embed ? 'Xenova/bge-m3' : '');
meta.run('ocr', String(ctx.opts.ocr));
ctx.db.exec('VACUUM');
ctx.db.close();

renameSync(tmp, join(OUT, '10h.db'));
writeFileSync(join(OUT, 'report.md'), ctx.report.toMarkdown(`Build report, ${new Date().toISOString().slice(0, 10)}`));
log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s: out/10h.db, out/report.md`);
if (failures) {
  log(`${failures} check failures, see out/report.md`);
  process.exitCode = 1;
}
