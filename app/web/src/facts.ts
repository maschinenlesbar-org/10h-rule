// Fact grouping shared by the entity view and the static entity pages of the export.
import type { Fact } from './types.ts';

// People and events first, citation lists last.
export function groupRank(label: string): number {
  const order = ['member of', 'asked', 'answered', 'spoke in', 'authored', 'signed', 'involved in', 'involves', 'documented in', 'documents',
    'asked by', 'answered by', 'speaker', 'authored by', 'responds to', 'responded to by', 'answered on behalf of', 'answered through',
    'located in', 'contains', 'broader', 'narrower', 'cites', 'cited by'];
  const i = order.indexOf(label);
  return i < 0 ? 50 : i;
}

// Facts grouped by direction and label, in display order, each group sorted by date and then by name.
export function groupFacts(facts: Fact[]): Array<{ label: string; facts: Fact[] }> {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    const key = `${f.direction}|${f.label}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups]
    .map(([key, fs]) => ({ label: key.split('|')[1], facts: fs.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || (a.other?.label ?? '').localeCompare(b.other?.label ?? '')) }))
    .sort((a, b) => groupRank(a.label) - groupRank(b.label));
}
