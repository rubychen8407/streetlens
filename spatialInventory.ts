import { createHash } from 'node:crypto';

/** Exact repeat rows are one observation. Conflicting upstream IDs retain
 * their distinct real data under stable IDs, independent of input order. */
export function normalizeSpatialInventory<T extends { id: string }>(features: T[]): T[] {
  // Most citywide IDs are unique. Serialize only colliding IDs instead of
  // retaining a second full inventory as JSON strings alongside the objects.
  const groups = new Map<string, { first: T; variants?: Map<string, T> }>();
  for (const feature of features) {
    const group = groups.get(feature.id);
    if (!group) groups.set(feature.id, { first: feature });
    else {
      group.variants ||= new Map([[JSON.stringify(group.first), group.first]]);
      group.variants.set(JSON.stringify(feature), feature);
    }
  }
  const result: T[] = [];
  const ids = new Set<string>();
  for (const [id, group] of groups) {
    for (const [content, feature] of group.variants || [[null, group.first] as const]) {
      const uniqueId = (group.variants?.size ?? 1) === 1 ? id : `${id}#${createHash('sha256').update(content!).digest('hex')}`;
      if (ids.has(uniqueId)) throw new Error('Ambiguous spatial feature ID');
      ids.add(uniqueId);
      result.push(uniqueId === feature.id ? feature : { ...feature, id: uniqueId });
    }
  }
  return result;
}
