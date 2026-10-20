import { describe, expect, it } from "vitest";
import { LOG_PREVIEW_LINES, limitLogLines } from "./log-view";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `Zeile ${i + 1}`).join("\n");

describe("limitLogLines", () => {
  it("lässt kurze Auszüge unverändert", () => {
    const r = limitLogLines(lines(5));
    expect(r.text).toBe(lines(5));
    expect(r.totalLines).toBe(5);
    expect(r.hiddenLines).toBe(0);
  });

  it("zeigt genau 30 Zeilen ohne Rest", () => {
    const r = limitLogLines(lines(LOG_PREVIEW_LINES));
    expect(r.hiddenLines).toBe(0);
    expect(r.text.split("\n")).toHaveLength(30);
  });

  it("kürzt längere Auszüge auf 30 Zeilen und nennt den Rest", () => {
    const r = limitLogLines(lines(45));
    expect(r.text.split("\n")).toHaveLength(30);
    expect(r.text.endsWith("Zeile 30")).toBe(true);
    expect(r.totalLines).toBe(45);
    expect(r.hiddenLines).toBe(15);
  });

  it("zählt einen abschließenden Zeilenumbruch nicht mit und kennt CRLF", () => {
    expect(limitLogLines("a\r\nb\r\n").totalLines).toBe(2);
    expect(limitLogLines("a\nb\n\n").text).toBe("a\nb");
  });

  it("leerer Auszug hat keine Zeilen", () => {
    expect(limitLogLines("")).toEqual({ text: "", totalLines: 0, hiddenLines: 0 });
    expect(limitLogLines("  \n ").totalLines).toBe(0);
  });

  it("eigene Grenze", () => {
    expect(limitLogLines(lines(4), 2)).toEqual({ text: "Zeile 1\nZeile 2", totalLines: 4, hiddenLines: 2 });
  });
});
