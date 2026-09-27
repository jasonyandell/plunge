/**
 * Canonical JSON for content addressing: object keys sorted, undefined members
 * dropped, no whitespace. The same value hashes the same in the browser, the
 * Worker and the build, whatever order its keys were written in.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
