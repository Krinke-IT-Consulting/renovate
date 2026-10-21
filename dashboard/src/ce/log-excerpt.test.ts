import { describe, expect, it } from "vitest";
import { extractLogExcerpt, LOG_MAX_BYTES, LOG_MAX_LINES, LOG_MAX_LINE_CHARS } from "./log-excerpt";

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

  describe("lange Zeilen", () => {
    it("kürzt eine einzelne Zeile über 16 KB und liefert nie einen leeren Auszug", () => {
      const out = extractLogExcerpt(line({ level: 50, msg: "x".repeat(40 * 1024) }));
      expect(out).not.toBe("");
      expect(out.endsWith("…")).toBe(true);
      expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(LOG_MAX_BYTES);
    });

    it("behält mehrere kurze Zeilen plus eine riesige letzte Zeile", () => {
      const text = [
        line({ level: 50, time: "2026-10-15T07:00:01Z", msg: "kurz eins" }),
        line({ level: 50, time: "2026-10-15T07:00:02Z", msg: "kurz zwei" }),
        line({ level: 50, time: "2026-10-15T07:00:03Z", msg: "y".repeat(100 * 1024) }),
      ].join("\n");
      const out = extractLogExcerpt(text);
      const rows = out.split("\n");
      expect(rows).toHaveLength(3);
      expect(rows[0]).toBe("07:00:01 ERROR kurz eins");
      expect(rows[2]!.length).toBeLessThanOrEqual(LOG_MAX_LINE_CHARS + 20);
    });

    it("bleibt auch bei mehrbytigen Zeichen nicht leer", () => {
      const out = extractLogExcerpt(line({ level: 50, msg: "€".repeat(50_000) }));
      expect(out).not.toBe("");
    });
  });

  describe("Maskierung im Meldungstext", () => {
    const msgOf = (msg: string, err?: { name?: string; message?: string }) =>
      extractLogExcerpt(line({ level: 50, time: "2026-10-15T07:00:00Z", msg, err }));

    it.each(["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"])("maskiert GitHub-Token %s", (prefix) => {
      const secret = `${prefix}AbCdEf0123456789xyz`;
      const out = msgOf(`Fehler mit ${secret} im Text`);
      expect(out).not.toContain(secret);
      expect(out).toContain("Fehler mit *** im Text");
    });

    it("maskiert Token auch in err.message und err.name", () => {
      const out = msgOf("x", { name: "ghp_NAMETOKEN123", message: "kaputt ghs_MSGTOKEN456" });
      expect(out).not.toMatch(/NAMETOKEN|MSGTOKEN/);
    });

    it("maskiert x-access-token:<…>@", () => {
      const out = msgOf("clone x-access-token:abc123SECRET@github.com/o/r");
      expect(out).not.toContain("abc123SECRET");
      expect(out).toContain("***");
    });

    it("maskiert Zugangsdaten in URLs", () => {
      const out = msgOf("GET https://benutzer:passwort42@example.com/pfad fehlgeschlagen");
      expect(out).not.toMatch(/benutzer|passwort42/);
      expect(out).toContain("https://***@example.com/pfad");
    });

    it("maskiert Bearer- und token-Header", () => {
      const a = msgOf("Header Authorization: Bearer eyJhbGciOi.SECRETPAYLOAD.sig");
      expect(a).not.toContain("SECRETPAYLOAD");
      const b = msgOf("Header authorization: token abcdef1234567890");
      expect(b).not.toContain("abcdef1234567890");
      expect(b).toContain("token ***");
    });

    it("maskiert private Schlüsselblöcke", () => {
      const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nGEHEIMERINHALT\n-----END RSA PRIVATE KEY-----";
      const out = msgOf(`Schlüssel ${key} ungültig`);
      expect(out).not.toMatch(/MIIEpA|GEHEIMERINHALT|BEGIN RSA/);
      expect(out).toContain("Schlüssel *** ungültig");
    });

    it("maskiert einen abgeschnittenen Schlüsselblock bis zum Ende", () => {
      const out = msgOf("-----BEGIN PRIVATE KEY-----\nGEHEIMERINHALT");
      expect(out).not.toContain("GEHEIMERINHALT");
    });

    it("lässt normale Meldungen unverändert", () => {
      const out = msgOf("Repository nicht gefunden: o/r, token expired, Branch renovate/foo", {
        name: "Error",
        message: "Request to https://api.github.com/repos/o/r failed",
      });
      expect(out).toBe(
        "07:00:00 ERROR Repository nicht gefunden: o/r, token expired, Branch renovate/foo (Error: Request to https://api.github.com/repos/o/r failed)",
      );
    });
  });
});
