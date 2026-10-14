#!/bin/sh
# Prüft beim Containerstart, dass alle Pflichtwerte gesetzt und nicht leer sind, und startet
# danach den Original-Entrypoint von Renovate CE (Change compose-stack, Entscheidung 6).
# Die Prüfung liegt hier statt als ${VAR:?} in der Compose-Datei, weil Coolify `compose build`
# nur mit den Build-Variablen ausführt; die Secrets stehen bewusst nur zur Laufzeit bereit.
# Ohne diese Prüfung nähme CE für ein fehlendes Webhook-Secret still den Standardwert
# "renovate". Meldungen nennen nur den Namen der Variable, nie einen Wert.
set -eu

missing=0
for name in MEND_RNV_LICENSE_KEY MEND_RNV_GITHUB_APP_ID MEND_RNV_GITHUB_APP_KEY \
  MEND_RNV_WEBHOOK_SECRET MEND_RNV_API_SERVER_SECRET PGPASSWORD; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "FEHLER: Pflichtvariable $name fehlt oder ist leer." >&2
    missing=1
  fi
done
unset value

if [ "$missing" -ne 0 ]; then
  exit 1
fi

exec /usr/local/sbin/renovate-entrypoint.sh "$@"
