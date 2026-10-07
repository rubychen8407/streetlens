import { createHash } from 'node:crypto';

/** Exact repeat rows are one observation. Conflicting upstream IDs retain
 * their distinct real data under stable IDs, independent of input order. */
export function normalizeSpatialInventory<T extends { id: string }>(features: T[]): T[] {
  const groups = new Map<string, Map<string, T>>();
  for (const feature of features) {
    const content = JSON.stringify(feature);
    const group = groups.get(feature.id) || new Map<string, T>();
    group.set(content, feature);
    groups.set(feature.id, group);
  }
  const result: T[] = [];
  const ids = new Set<string>();
  for (const [id, group] of groups) {
    for (const [content, feature] of group) {
      const uniqueId = group.size === 1 ? id : `${id}#${createHash('sha256').update(content).digest('hex')}`;
      if (ids.has(uniqueId)) throw new Error('Ambiguous spatial feature ID');
      ids.add(uniqueId);
      result.push(uniqueId === feature.id ? feature : { ...feature, id: uniqueId });
    }
  }
  return result;
}
