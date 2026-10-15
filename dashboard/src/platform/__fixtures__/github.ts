/**
 * FIXTURES: selbst gebaute, verkürzte GitHub-Antworten. Keine echten Daten außer den
 * Owner-Namen Hiwamashi und Krinke-IT-Consulting. Nicht aufgezeichnet, nur formgleich.
 */
export const APP_SLUG = "krinke-it-renovate";
export const BOT = `${APP_SLUG}[bot]`;
export const INSTALLATION_ID = 424242;
export const REPO = {
  fullName: "Krinke-IT-Consulting/fixture-repo",
  defaultBranch: "main",
};
export const HEAD_SHA = "1111111111111111111111111111111111111111";
export const API = "https://api.github.com";

export const installations = [
  {
    id: INSTALLATION_ID,
    suspended_at: null,
    account: { login: "Krinke-IT-Consulting", type: "Organization" },
  },
  {
    id: 424243,
    suspended_at: null,
    account: { login: "Hiwamashi", type: "User" },
  },
  {
    id: 424244,
    suspended_at: "2026-01-01T00:00:00Z",
    account: { login: "Suspended-Fixture", type: "User" },
  },
];

export const installationRepositories = {
  total_count: 2,
  repositories: [
    {
      id: 1001,
      full_name: "Krinke-IT-Consulting/fixture-repo",
      default_branch: "main",
      archived: false,
      private: true,
    },
    {
      id: 1002,
      full_name: "Krinke-IT-Consulting/fixture-old",
      default_branch: "master",
      archived: true,
      private: false,
    },
  ],
};

export function pull(over: {
  number: number;
  title?: string;
  ref?: string;
  login?: string;
  labels?: string[];
  body?: string;
  autoMerge?: unknown;
}) {
  return {
    number: over.number,
    title: over.title ?? `Update fixture ${over.number}`,
    html_url: `https://github.com/${REPO.fullName}/pull/${over.number}`,
    body: over.body ?? "",
    labels: (over.labels ?? []).map((name) => ({ name })),
    head: {
      ref: over.ref ?? `renovate/fixture-${over.number}`,
      sha: `${over.number}`.padStart(40, "a"),
    },
    user: { login: over.login ?? BOT },
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-02T08:00:00Z",
    auto_merge: over.autoMerge ?? null,
    state: "open",
    merged_at: null,
  };
}

export function dirEntry(name: string, type: "file" | "dir") {
  return { name, type, path: name };
}

export function fileBody(text: string) {
  return {
    type: "file",
    encoding: "base64",
    content: Buffer.from(text, "utf8").toString("base64"),
  };
}
