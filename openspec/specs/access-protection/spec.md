# access-protection Specification

## Purpose

Schützt die Oberfläche der Renovate-Plattform: Nur der Betreiber kommt mit Passwort und zweitem
Faktor hinein, und der geschützte Dienst erfährt verlässlich, wer angemeldet ist.

## Requirements

### Requirement: Login mit zwei Faktoren vor der Oberfläche
Jeder Aufruf von `https://renovate.krinke-it.cloud` außer `/webhook` MUST eine Anmeldung bei
Authelia unter `https://renovate-auth.krinke-it.cloud` verlangen. Die Anmeldung besteht aus
Passwort und TOTP-Code.

#### Scenario: Aufruf ohne Sitzung
- **WHEN** jemand ohne Sitzung `https://renovate.krinke-it.cloud/` aufruft
- **THEN** wird er zur Anmeldeseite von Authelia umgeleitet und danach zurück zur ursprünglichen
  Seite

#### Scenario: Nur Passwort
- **WHEN** jemand das richtige Passwort eingibt, aber keinen TOTP-Code
- **THEN** bleibt ihm die Oberfläche verschlossen

### Requirement: Standardmäßig verweigern
Authelia MUST jeden Zugriff verweigern, den keine Regel ausdrücklich erlaubt. Erlaubt ist nur der
Zugriff des Betreibers mit zwei Faktoren auf `renovate.krinke-it.cloud`.

#### Scenario: Unbekannter Hostname
- **WHEN** eine Anfrage für einen anderen Hostnamen an diese Authelia-Instanz geht
- **THEN** wird sie verweigert

### Requirement: Genau ein Nutzer, nicht im Repo
Authelia MUST genau ein Konto kennen, das des Betreibers. Nutzerdaten und Passwort-Hash MUST NOT
im Repo stehen. Sie werden einmalig per Skript auf dem persistenten Volume angelegt. Die
Selbstregistrierung und das Zurücksetzen des Passworts per Mail MUST deaktiviert sein.

#### Scenario: Konto anlegen
- **WHEN** der Betreiber das Einrichtungsskript ausführt und sein Passwort in die
  Eingabeaufforderung tippt
- **THEN** liegt auf dem Volume eine Nutzerdatei mit genau einem Konto und einem argon2id-Hash,
  und das Passwort erscheint weder in einer Kommandozeile noch in einer Protokollausgabe

### Requirement: TOTP-Einrichtung ohne Mailserver
Den Bestätigungscode für die Einrichtung des TOTP-Geräts MUST Authelia in eine Datei im Container
schreiben, nicht per Mail verschicken.

#### Scenario: Erstes Anmelden
- **WHEN** sich der Betreiber zum ersten Mal anmeldet und ein TOTP-Gerät einrichten will
- **THEN** kann er den Bestätigungscode per SSH auf dem Server aus der Datei lesen

### Requirement: Identität an den geschützten Dienst
Nach erfolgreicher Anmeldung MUST der geschützte Dienst den angemeldeten Nutzer über die Header
`Remote-User`, `Remote-Email`, `Remote-Name` und `Remote-Groups` erhalten. Von außen
mitgeschickte Header dieses Namens MUST NOT beim Dienst ankommen. Der geschützte Dienst ist das
Dashboard. Es MUST die Sitzung zusätzlich selbst bei Authelia prüfen. Anfragen ohne gültige Sitzung
MUST es abweisen, auch wenn sie diese Header tragen.

#### Scenario: Angemeldeter Aufruf
- **WHEN** der angemeldete Betreiber das Dashboard aufruft
- **THEN** zeigt es im Kopf den Kontonamen aus `Remote-User`

#### Scenario: Gefälschter Header
- **WHEN** jemand mit gültiger Sitzung zusätzlich selbst `Remote-User: admin` mitschickt
- **THEN** sieht der Dienst nur den von Authelia gesetzten Wert

#### Scenario: Umgehung des Routers
- **WHEN** ein Container das Dashboard unter Umgehung von Traefik direkt mit `Remote-User` aufruft
- **THEN** weist das Dashboard die Anfrage ab

### Requirement: Sitzung begrenzt
Eine Sitzung MUST nach 12 Stunden und nach einer Stunde Inaktivität ablaufen. Ein Neustart von
Authelia darf alle Sitzungen beenden; das registrierte TOTP-Gerät MUST erhalten bleiben.

#### Scenario: Inaktivität
- **WHEN** der Betreiber eine Stunde lang nichts tut
- **THEN** verlangt der nächste Aufruf eine neue Anmeldung
