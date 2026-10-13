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
  // Archivierte Repos und Forks überspringt Renovate standardmäßig (forkProcessing "auto" im Autodiscover-Modus).
  // Optional: Scaleway Container Registry (Region fr-par), nur mit gesetzter Variable.
  hostRules: process.env.SCW_REGISTRY_SECRET_KEY
    ? [
        {
          matchHost: "rg.fr-par.scw.cloud",
          hostType: "docker",
          username: "nologin",
          password: process.env.SCW_REGISTRY_SECRET_KEY,
        },
      ]
    : [],
};
