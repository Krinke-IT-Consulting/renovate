import { describe, expect, it } from "vitest";
import { extractLogExcerpt, LOG_MAX_BYTES, LOG_MAX_LINES } from "./log-excerpt";

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe("extractLogExcerpt", () => {
  it("behält nur Level >= 40 und formatiert kompakt", () => {
    const text = [
      line({ level: 20, time: "2026-10-15T07:00:01Z", msg: "debug" }),
      line({ level: 30, time: "2026-10-15T07:00:02Z", msg: "info" }),
      line({ level: 40, time: "2026-10-15T07:00:03Z", msg: "Warnung" }),
      line({ level: 50, time: "2026-10-15T07:00:04Z", msg: "Fehler", err: { name: "Error", message: "kaputt", stack: "geheim\nstack" } }),
    ].join("\n");
    expect(extractLogExcerpt(text)).toBe("07:00:03 WARN Warnung\n07:00:04 ERROR Fehler (Error: kaputt)");
  });

  it("entfernt token-, password-, secret- und key-Felder rekursiv und gibt nur Basisfelder aus", () => {
    const text = line({
      level: 50,
      time: "2026-10-15T07:00:00Z",
      msg: "Request fehlgeschlagen",
      token: "ghs_SECRETTOKEN",
      headers: { authorization: "x", apiKey: "SECRETKEY", nested: { Password: "pw" } },
      err: { name: "HttpError", message: "403", token: "ghs_INERR", secretValue: "s" },
    });
    const out = extractLogExcerpt(text);
    expect(out).toBe("07:00:00 ERROR Request fehlgeschlagen (HttpError: 403)");
    for (const leak of ["ghs_SECRETTOKEN", "SECRETKEY", "pw", "ghs_INERR"]) expect(out).not.toContain(leak);
  });

  it("entfernt sensible Felder auch dann, wenn sie in err.message-fremden Feldern stehen", () => {
    const out = extractLogExcerpt(line({ level: 40, msg: "m", err: { message: "ok", apiKey: "K1" } }));
    expect(out).not.toContain("K1");
    expect(out).toContain("ok");
  });

  it("ignoriert nicht parsebare und fremde Zeilen", () => {
    const text = ["kein json", "{kaputt", "[1,2]", line({ level: "50", msg: "string-level" }), line({ level: 50, msg: "ok", time: "2026-10-15T01:02:03Z" })].join("\n");
    expect(extractLogExcerpt(text)).toBe("01:02:03 ERROR ok");
  });

  it("begrenzt auf die letzten 200 Zeilen", () => {
    const text = Array.from({ length: 300 }, (_, i) => line({ level: 40, time: "2026-10-15T00:00:00Z", msg: `m${i}` })).join("\n");
    const lines = extractLogExcerpt(text).split("\n");
    expect(lines).toHaveLength(LOG_MAX_LINES);
    expect(lines[0]).toContain("m100");
    expect(lines.at(-1)).toContain("m299");
  });

  it("begrenzt auf 16 KB und behält die letzten Zeilen", () => {
    const text = Array.from({ length: 100 }, (_, i) => line({ level: 40, time: "2026-10-15T00:00:00Z", msg: `${i}:${"x".repeat(500)}` })).join("\n");
    const out = extractLogExcerpt(text);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(LOG_MAX_BYTES);
    expect(out.split("\n").at(-1)).toContain("99:");
  });

  it("liefert leeren Text ohne Treffer", () => {
    expect(extractLogExcerpt("")).toBe("");
    expect(extractLogExcerpt(line({ level: 30, msg: "x" }))).toBe("");
  });
});
