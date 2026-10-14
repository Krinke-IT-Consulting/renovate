#!/usr/bin/env bash
#
# Legt das einzige Authelia-Konto (Betreiber) einmalig auf dem Volume an oder ersetzt es.
# Wird vom Betreiber per SSH auf dem Server ausgefuehrt, nicht von einem Agenten.
#
# Das Passwort steht nie in einer Kommandozeile und nie in einer Variable dieses Skripts: Der
# Betreiber gibt es direkt im Prompt von `authelia crypto hash generate argon2` ein (in einem
# Wegwerf-Container, `docker run --rm -it`), samt Bestaetigung. Das Skript liest aus der Ausgabe
# nur den argon2id-Digest und schreibt ihn nach /data/users_database.yml.
#
# Mindestlaenge: Das Skript kann sie nicht pruefen, und Authelia prueft sie bei der
# Hash-Erzeugung ebenfalls nicht (gemessen: `password_policy` in configuration.yml wird von
# `hash generate` nicht angewendet). Der Betreiber waehlt selbst ein Passwort mit mindestens
# zwoelf Zeichen.
#
# Aufruf auf dem Server:
#   deploy/scripts/setup-authelia-user.sh
# Optional:
#   AUTHELIA_CONTAINER=<name>   Pflicht, wenn mehr als ein Authelia-Container laeuft
#                               (auf gentle-goose laeuft auch das von vaultsync)
#   AUTHELIA_USERNAME, AUTHELIA_DISPLAYNAME, AUTHELIA_EMAIL
#
# Das Konto ist nur mit zweitem Faktor nutzbar (Regel two_factor): Beim ersten Anmelden den
# Einmalcode aus /data/notification.txt im Container lesen und TOTP registrieren.
set -euo pipefail

die() { printf '%s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker wird benoetigt"

if [ ! -t 0 ]; then
    die "Dieses Skript braucht ein echtes Terminal (Passworteingabe). Nichts wurde geaendert."
fi

container="${AUTHELIA_CONTAINER:-}"
if [ -z "$container" ]; then
    found="$(docker ps --filter 'label=com.docker.compose.service=renovate-authelia' --format '{{.Names}}')"
    count="$(printf '%s\n' "$found" | grep -c . || true)"
    [ "$count" -eq 1 ] || die "Gefunden: $count Authelia-Container. Setze AUTHELIA_CONTAINER=<name>. Nichts wurde geaendert."
    container="$found"
fi
docker inspect "$container" >/dev/null 2>&1 || die "Container '$container' existiert nicht. Nichts wurde geaendert."

username="${AUTHELIA_USERNAME:-}"
[ -n "$username" ] || read -r -p "Benutzername: " username
displayname="${AUTHELIA_DISPLAYNAME:-$username}"
email="${AUTHELIA_EMAIL:-}"
[ -n "$email" ] || read -r -p "E-Mail: " email
case "$username$displayname$email" in
    *[\'\"\\]*|*$'\n'*) die "Benutzername, Anzeigename und E-Mail duerfen keine Anfuehrungszeichen, Backslashes oder Zeilenumbrueche enthalten." ;;
esac
[[ "$username" =~ ^[A-Za-z0-9._-]+$ ]] || die "Der Benutzername darf nur Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich enthalten. Nichts wurde geaendert."
[ -n "$username" ] && [ -n "$email" ] || die "Benutzername und E-Mail duerfen nicht leer sein."

image="$(docker inspect -f '{{.Config.Image}}' "$container")"
printf 'Passwort fuer Authelia eingeben (mindestens 12 Zeichen, Eingabe bleibt unsichtbar):\n'
# Die Ausgabe laeuft ueber /dev/tty zum Betreiber und wird zugleich in $out gesammelt; darin
# steht nur der Hash, nie das Passwort (der Prompt gibt es nicht aus).
out="$(docker run --rm -it "$image" authelia crypto hash generate argon2 | tee /dev/tty)" ||
    die "Die Hash-Erzeugung ist fehlgeschlagen. Nichts wurde geaendert."
hash="$(printf '%s\n' "$out" | tr -d '\r' | sed -n 's/^Digest: //p')"
unset out
# shellcheck disable=SC2016
case "$hash" in
    '$argon2id$'*) ;;
    *) die "Aus der Ausgabe von Authelia liess sich kein Hash lesen. Nichts wurde geaendert." ;;
esac

# Genau ein Konto: die Datei wird ersetzt, nicht ergaenzt. Einfache Anfuehrungszeichen, damit
# die $-Zeichen des Hashes in YAML unveraendert bleiben.
printf 'users:\n  %s:\n    disabled: false\n    displayname: '"'"'%s'"'"'\n    password: '"'"'%s'"'"'\n    email: '"'"'%s'"'"'\n    groups:\n      - admins\n' \
    "$username" "$displayname" "$hash" "$email" |
    docker exec -i "$container" sh -c 'umask 077 && cat > /data/users_database.yml'
unset hash

docker exec "$container" test -s /data/users_database.yml || die "Die Nutzerdatei fehlt nach dem Schreiben."

cat <<MSG

Fertig: Das Konto '$username' existiert mit Passwort, aber noch ohne zweiten Faktor.
Authelia liest die Datei selbst neu ein (watch), ein Neustart ist nicht noetig.

Naechster Schritt (gehoert dazu):
  1. https://renovate.krinke-it.cloud im Browser oeffnen und anmelden.
  2. Authelia verlangt die TOTP-Einrichtung und schreibt den Bestaetigungscode in eine Datei:
       docker exec $container cat /data/notification.txt
  3. Code eingeben, QR-Code mit der Authenticator-App scannen, bestaetigen.
MSG
