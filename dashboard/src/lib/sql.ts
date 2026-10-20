/** `%`, `_` und `\` in einem Suchtext wörtlich nehmen (für LIKE/ILIKE). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Teilstring-Muster für ILIKE: `%text%` mit maskierten Sonderzeichen. */
export function likePattern(q: string): string {
  return `%${escapeLike(q)}%`;
}
