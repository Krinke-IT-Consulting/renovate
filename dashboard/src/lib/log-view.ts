/** Anzeigegrenze des Log-Auszugs in Zeilen (ansichten-entwurf.md, Abschnitt "Jobs"). */
export const LOG_PREVIEW_LINES = 30;

export type LogPreview = {
  /** Sichtbarer Text, höchstens `maxLines` Zeilen. */
  text: string;
  /** Gesamtzahl der Zeilen des Auszugs. */
  totalLines: number;
  /** Zeilen, die nicht im sichtbaren Text stehen. */
  hiddenLines: number;
};

/**
 * Kürzt den Auszug auf die ersten `maxLines` Zeilen. Zeilenenden (\n, \r\n) werden vereinheitlicht,
 * ein abschließender Zeilenumbruch zählt nicht als eigene Zeile.
 */
export function limitLogLines(excerpt: string, maxLines: number = LOG_PREVIEW_LINES): LogPreview {
  const lines = excerpt.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  const totalLines = excerpt.trim() === "" ? 0 : lines.length;
  if (totalLines <= maxLines) return { text: lines.join("\n"), totalLines, hiddenLines: 0 };
  return { text: lines.slice(0, maxLines).join("\n"), totalLines, hiddenLines: totalLines - maxLines };
}
