/**
 * Database helpers.
 *
 * Free plan D1 limits that shape this code:
 *   - 50 queries per Worker invocation
 *   - 100 bound parameters per query
 *   - 2 MB per string value
 *
 * Bulk writes therefore pass rows as a JSON array in a single parameter and
 * expand it in SQL with json_each(), instead of issuing one statement (or one
 * group of parameters) per row.
 */

/** Max bytes for one JSON parameter (D1 allows 2 MB per value). */
const MAX_JSON_PARAM_BYTES = 1_800_000;

/**
 * Split rows into JSON array strings that each fit in one bound parameter.
 */
export function chunkJson<T>(rows: T[], maxBytes = MAX_JSON_PARAM_BYTES): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 2;

  for (const row of rows) {
    const encoded = JSON.stringify(row);
    if (current.length > 0 && size + encoded.length + 1 > maxBytes) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      size = 2;
    }
    current.push(encoded);
    size += encoded.length + 1;
  }
  if (current.length > 0) chunks.push(`[${current.join(',')}]`);
  return chunks;
}

/** Parse a JSON array column, tolerating corrupt data. */
export function parseJsonArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
