# Renovate CE mit eingebauter globaler Konfiguration (Change compose-stack, Entscheidung 1).
# config.js wird ins Image gebacken statt gemountet: Coolify schreibt Datei-Mounts nur beim
# Anlegen auf den Host. Die Datei enthaelt keine Secrets. Version wird von Renovate gepflegt.
FROM ghcr.io/mend/renovate-ce:15.7.0

COPY config.js /usr/src/app/config.js
