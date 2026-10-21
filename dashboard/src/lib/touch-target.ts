/**
 * Trefferfläche von mindestens 44 px für reine Text-Links in Karten und Meta-Zeilen. Ein
 * Pseudo-Element liegt mittig über dem Link und ragt über ihn hinaus (wie bei `LogToggle`); der
 * Link selbst behält seine Größe, die Zeile ihren Abstand. Bei hohen Links (Umbruch) zählt deren
 * eigene Höhe. Der Link braucht `relative`, das steckt in der Konstante.
 *
 * Benachbarte Ziele dürfen sich nicht überdecken: Zeilen, die so einen Link tragen, sind mindestens
 * 44 px hoch (Tabelle: `h-11`; Karten: Abstand zwischen den Zeilen).
 */
export const TOUCH_TARGET =
  "relative after:absolute after:top-1/2 after:-inset-x-1 after:h-full after:min-h-11 after:-translate-y-1/2 after:content-['']";
