// Dictionary matcher over the alias table. Longest alias wins; word boundaries are Unicode-aware,
// so "Sachsen" does not match inside "Niedersachsen", and "Sachsen-Anhalt" is preferred over "Sachsen".

type DbLike = { prepare(sql: string): { all(...p: any[]): unknown[] } };

export interface DictMatch { entityId: string; type: string; start: number; end: number; surface: string }

export class Dict {
  private re: RegExp;
  private byAlias = new Map<string, Array<{ id: string; type: string }>>();

  constructor(db: DbLike, opts: { types: string[]; kinds?: string[] }) {
    const rows = db.prepare(`SELECT a.alias, a.entity_id, e.type, a.kind FROM alias a JOIN entity e ON e.id = a.entity_id`)
      .all() as Array<{ alias: string; entity_id: string; type: string; kind: string }>;
    for (const r of rows) {
      if (!opts.types.includes(r.type)) continue;
      if (opts.kinds && !opts.kinds.includes(r.kind)) continue;
      if (r.alias.length < 2) continue;
      const list = this.byAlias.get(r.alias) ?? [];
      if (!list.some((x) => x.id === r.entity_id)) list.push({ id: r.entity_id, type: r.type });
      this.byAlias.set(r.alias, list);
    }
    const aliases = [...this.byAlias.keys()].sort((a, b) => b.length - a.length);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    this.re = aliases.length
      ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${aliases.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
      : /$^/gu;
  }

  // Ambiguous aliases (shared by several entities) are skipped and returned separately.
  match(text: string): { hits: DictMatch[]; ambiguous: string[] } {
    const hits: DictMatch[] = [];
    const ambiguous: string[] = [];
    this.re.lastIndex = 0;
    for (const m of text.matchAll(this.re)) {
      const surface = m[0];
      const list = this.byAlias.get(surface.replace(/\s+/g, ' '));
      if (!list) continue;
      if (list.length > 1) { ambiguous.push(surface); continue; }
      hits.push({ entityId: list[0].id, type: list[0].type, start: m.index!, end: m.index! + surface.length, surface });
    }
    return { hits, ambiguous };
  }
}
