// Globale (self-hosted) Konfiguration fuer Renovate CE.
// Betriebsparameter (Lizenz, App, Datenbank, Webhook, Autodiscover-Filter) kommen als
// MEND_RNV_*-Umgebungsvariablen, nicht aus dieser Datei. Secrets stehen hier nie als Wert,
// sondern werden nur aus Umgebungsvariablen gelesen.
module.exports = {
  // Onboarding uebernimmt das Dashboard, nicht Renovate.
  onboarding: false,
  // Repos ohne eigene Renovate-Konfiguration werden uebersprungen.
  requireConfig: "required",
  // Werkzeuge (Node, pnpm, Bun, Python, Go, CocoaPods) bei Bedarf installieren.
  binarySource: "install",
  // Download-Cache der Werkzeuge liegt so im Volume renovate-cache (/tmp/renovate) und
  // überdauert Redeploys.
  containerbaseDir: "/tmp/renovate/cache/containerbase",
  // Archivierte Repos und Forks überspringt Renovate standardmäßig (forkProcessing "auto" im Autodiscover-Modus).
  // Optional: Scaleway Container Registry (Region nl-ams), nur mit gesetzter Variable.
  // Der Namespace krinke-dockersolutions ist öffentlich und braucht keine Zugangsdaten;
  // die Regel ist für spätere private Namespaces gedacht.
  hostRules: process.env.SCW_REGISTRY_SECRET_KEY
    ? [
        {
          matchHost: "rg.nl-ams.scw.cloud",
          hostType: "docker",
          username: "nologin",
          password: process.env.SCW_REGISTRY_SECRET_KEY,
        },
      ]
    : [],
};
