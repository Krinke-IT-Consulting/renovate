import { describe, expect, it, vi } from "vitest";
import { refreshRepositoryState } from "./refresh";
import type {
  PlatformAdapter,
  PlatformConnection,
  RepositoryRef,
} from "./types";

const conn: PlatformConnection = {
  externalConnectionId: "1",
  ownerName: "Krinke-IT-Consulting",
  ownerType: "organization",
};
const repo: RepositoryRef = {
  fullName: "Krinke-IT-Consulting/fixture-repo",
  defaultBranch: "main",
};

function fakeAdapter(sha: string | null) {
  const getHeadSha = vi.fn(async () => sha);
  const getRepositoryState = vi.fn(async () => ({
    configPath: "renovate.json",
    hasBuildCheck: true,
  }));
  return {
    adapter: { getHeadSha, getRepositoryState } as unknown as PlatformAdapter,
    getHeadSha,
    getRepositoryState,
  };
}

describe("refreshRepositoryState (Head-SHA-Logik)", () => {
  it("(b) unveränderter Head-SHA: kein Inhaltsabruf", async () => {
    const { adapter, getHeadSha, getRepositoryState } = fakeAdapter("abc");
    const result = await refreshRepositoryState(adapter, conn, repo, "abc");
    expect(result).toEqual({ headSha: "abc", changed: false, state: null });
    expect(getHeadSha).toHaveBeenCalledTimes(1);
    expect(getRepositoryState).not.toHaveBeenCalled();
  });

  it("geänderter Head-SHA: Inhalt wird gelesen", async () => {
    const { adapter, getRepositoryState } = fakeAdapter("def");
    const result = await refreshRepositoryState(adapter, conn, repo, "abc");
    expect(result.changed).toBe(true);
    expect(result.state).toEqual({
      configPath: "renovate.json",
      hasBuildCheck: true,
    });
    expect(getRepositoryState).toHaveBeenCalledWith(conn, repo, "def");
  });

  it("unbekannter Stand (neues Repo): Inhalt wird gelesen", async () => {
    const { adapter, getRepositoryState } = fakeAdapter("abc");
    const result = await refreshRepositoryState(adapter, conn, repo, null);
    expect(result.changed).toBe(true);
    expect(getRepositoryState).toHaveBeenCalledTimes(1);
  });
});

describe("refreshRepositoryState: leeres Repo", () => {
  it("ohne Head-SHA gilt das Repo als ohne Inhalt, ohne Inhaltsabruf", async () => {
    const { adapter, getRepositoryState } = fakeAdapter(null);
    expect(await refreshRepositoryState(adapter, conn, repo, null)).toEqual({
      headSha: null,
      changed: false,
      state: { configPath: null, hasBuildCheck: false },
    });
    // Das Repo war vorher nicht leer (Commits verschwunden): Änderung, Inhalt wird zurückgesetzt.
    const result = await refreshRepositoryState(adapter, conn, repo, "abc");
    expect(result).toMatchObject({ headSha: null, changed: true });
    expect(result.state).toEqual({ configPath: null, hasBuildCheck: false });
    expect(getRepositoryState).not.toHaveBeenCalled();
  });
});
