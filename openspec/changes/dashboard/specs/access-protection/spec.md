# Spec Delta

## MODIFIED Requirements

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
