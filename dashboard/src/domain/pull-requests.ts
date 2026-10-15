/** Reine Ableitungen für Renovate-PRs (Spec dashboard-sync, "Update-Typ und Status ableiten"). */

export type UpdateType =
  | "major"
  | "minor"
  | "patch"
  | "security"
  | "digest"
  | "lockfile"
  | "other";
export type CiStatus = "success" | "failure" | "pending" | "none";

/** Rangfolge: security > major > minor > patch > digest > lockfile, sonst other. */
const UPDATE_TYPE_ORDER: readonly Exclude<UpdateType, "other">[] = [
  "security",
  "major",
  "minor",
  "patch",
  "digest",
  "lockfile",
];

/** Labels des Presets: `security` und `update:<typ>` (default.json); der Typ allein gilt ebenso. */
export function deriveUpdateType(labels: readonly string[]): UpdateType {
  const names = new Set(
    labels.map((l) => l.trim().toLowerCase().replace(/^update[:/]\s*/, "")),
  );
  return UPDATE_TYPE_ORDER.find((t) => names.has(t)) ?? "other";
}

const MAX_PACKAGES = 50;

/** Trennzeile einer Markdown-Tabelle, etwa `|---|:--:|`. */
const SEPARATOR_ROW = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Name aus der ersten Tabellenzelle: Linktext von `[name](...)`, sonst Zelle ohne ` (...)`-Anhang. */
function packageFromCell(cell: string): string {
  const link = /^\[([^\]]+)\]\(/.exec(cell);
  const raw = link ? link[1]! : cell.replace(/\s+\(.*\)\s*$/, "");
  return raw.replace(/`/g, "").trim();
}

function packagesFromTables(body: string): { found: boolean; names: string[] } {
  const lines = body.split(/\r?\n/);
  const names: string[] = [];
  let found = false;
  for (let i = 0; i < lines.length - 1; i++) {
    const head = lines[i]!.trim();
    if (!head.startsWith("|")) continue;
    if (splitCells(head)[0]?.toLowerCase() !== "package") continue;
    if (!SEPARATOR_ROW.test(lines[i + 1]!.trim())) continue;
    found = true;
    let j = i + 2;
    for (; j < lines.length; j++) {
      const row = lines[j]!.trim();
      if (!row.startsWith("|")) break;
      const name = packageFromCell(splitCells(row)[0] ?? "");
      if (name) names.push(name);
    }
    i = j - 1;
  }
  return { found, names };
}

/** Optionaler Conventional-Commit-Präfix, etwa `chore(deps): `. */
const TITLE_PREFIX = "(?:[a-z]+(?:\\([^)]*\\))?!?:\\s*)?";
const SINGLE_TITLE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^${TITLE_PREFIX}update dependency (\\S+) to\\s`, "i"),
  new RegExp(`^${TITLE_PREFIX}update (\\S+) action to\\s`, "i"),
  new RegExp(`^${TITLE_PREFIX}update (\\S+) docker tag to\\s`, "i"),
  new RegExp(`^${TITLE_PREFIX}pin dependency (\\S+)(?: to\\s|\\s*$)`, "i"),
];
/** Gruppen: `renovate/minor-updates`, `renovate/all-patch`, Titel wie "minor updates (minor)". */
const GROUP_BRANCH = /^renovate\/(?:.+-updates?|(?:all-)?(?:major|minor|patch|digest))$/i;
const GROUP_TITLE = /\b(?:major|minor|patch|digest|non-major|all)\s+(?:updates?|dependencies)\b/i;
const GROUP_WORDS = new Set(["major", "minor", "patch", "digest", "all", "non-major"]);

function packageFromTitle(title: string, branch: string): string[] {
  if (GROUP_BRANCH.test(branch) || GROUP_TITLE.test(title)) return [];
  for (const pattern of SINGLE_TITLE_PATTERNS) {
    const name = pattern.exec(title.trim())?.[1]?.replace(/`/g, "");
    if (name && !GROUP_WORDS.has(name.toLowerCase())) return [name];
  }
  return [];
}

/**
 * Pakete, die ein Renovate-PR aktualisiert. Hauptquelle sind die Markdown-Tabellen im PR-Text
 * (Kopfzeile mit `Package` in der ersten Zelle; Gruppen-PRs haben mehrere). Nur ohne Tabelle gilt
 * der Titel eines Einzel-PRs. Gruppen und Lockfile-Maintenance liefern ein leeres Array; es wird
 * nie geraten. Ohne Duplikate, höchstens 50.
 */
export function parseUpdatePackages(input: {
  body?: string | null;
  title: string;
  branch: string;
}): string[] {
  const body = input.body ?? "";
  const tables = packagesFromTables(body);
  const names = tables.found ? tables.names : packageFromTitle(input.title, input.branch);
  return [...new Set(names)].slice(0, MAX_PACKAGES);
}
