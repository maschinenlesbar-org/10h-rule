// Step 3: vocabularies from data/*.csv → entities, aliases, predicates, hierarchy statements.

import { join } from 'node:path';
import { DATA, log, type Ctx } from '../lib/ctx.ts';
import { readCsv } from '../lib/text.ts';
import { upsertEntity, addAlias, addStatement } from '../lib/db.ts';

const split = (s: string) => s.split('|').map((x) => x.trim()).filter(Boolean);

export function seed(ctx: Ctx): void {
  const { db } = ctx;
  const insPred = db.prepare(`INSERT INTO predicate (id, label_de, label_en, inverse_en, domain, range, interpretive, description)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const p of readCsv(join(DATA, 'predicates.csv'))) {
    insPred.run(p.id, p.label_de, p.label_en, p.inverse_en, p.domain, p.range, Number(p.interpretive), p.description);
  }

  const vocab: Array<[string, string, string]> = [
    ['organizations.csv', 'Organization', ''],
    ['places.csv', 'Place', 'located_in'],
    ['concepts.csv', 'Concept', 'broader'],
    ['laws.csv', 'Law', 'broader'],
  ];
  let n = 0;
  for (const [file, type, hierarchy] of vocab) {
    for (const r of readCsv(join(DATA, file))) {
      const props: Record<string, string> = {};
      if (r.classification) props.classification = r.classification;
      if (r.description) props.description = r.description;
      upsertEntity(db, r.id, type, r.label, props);
      addAlias(db, r.id, r.label, 'label');
      for (const a of split(r.aliases ?? '')) addAlias(db, r.id, a, 'alias');
      const parent = r.parent || r.broader;
      if (hierarchy && parent) addStatement(db, { subj: r.id, pred: hierarchy, obj: parent, marker: 'primary', method: 'seed', source: `data/${file}` });
      n++;
    }
  }
  log(`seed: ${n} vocabulary entities`);
}
