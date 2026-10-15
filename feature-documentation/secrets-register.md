# Secrets-Register

Selbst erzeugte Werte der Renovate-Plattform. Dieses Register nennt nur Namen, nie Werte.
Alle acht Werte werden mit `openssl rand -hex 32` erzeugt. Sie stehen in `.env.production` (nicht
versioniert) und in der Coolify-Ressource (Variablen der Compose-Ressource). Beim Neuerzeugen:
Wert in `.env.production` ersetzen, in Coolify nachziehen, Redeploy nach Freigabe.

Neuerzeugen (Muster, Wert erscheint nicht auf dem Bildschirm):

    printf 'NAME=%s\n' "$(openssl rand -hex 32)"   # nur in die passende Datei umleiten, nie ausgeben

Von Menschen gelieferte Werte (`MEND_RNV_LICENSE_KEY`, `MEND_RNV_GITHUB_APP_ID`,
`MEND_RNV_GITHUB_APP_KEY`, optional `SCW_REGISTRY_SECRET_KEY`) gehören nicht hierher; ihre Herkunft
steht in `.env.example`.

| Name | Herkunft | Zweck | Ablage im Betrieb | Neuerzeugung und Folgen |
|---|---|---|---|---|
| `MEND_RNV_WEBHOOK_SECRET` | selbst erzeugt | Signatur der GitHub-Webhooks an `/webhook` | Coolify-Variable, Dienst `renovate-ce` | Neu erzeugen und gleichzeitig im Feld „Webhook secret" der GitHub App ändern, sonst lehnt CE alle Webhooks ab. Redeploy von `renovate-ce`. |
| `MEND_RNV_API_SERVER_SECRET` | selbst erzeugt | Zugriff auf die interne Job-API von CE | Coolify-Variable, Dienste `renovate-ce` und `renovate-dashboard` | Neu erzeugen, Redeploy des ganzen Stacks: CE und Dashboard brauchen denselben Wert. |
| `POSTGRES_PASSWORD` | selbst erzeugt | Superuser von Postgres, nur Wartung | Coolify-Variable, Dienst `postgres` | Wirkt nur bei leerem Volume. Im Betrieb per `ALTER ROLE postgres PASSWORD ...` ändern, dann Variable anpassen. |
| `RENOVATE_CE_DB_PASSWORD` | selbst erzeugt | Rolle `renovate_ce` (Datenbank `renovate_ce`) | Coolify-Variable, Dienste `postgres` und `renovate-ce` | Im Betrieb per `ALTER ROLE renovate_ce PASSWORD ...`, danach Variable ändern und `renovate-ce` neu starten. Das Init-Skript läuft nur bei leerem Volume. |
| `DASHBOARD_DB_PASSWORD` | selbst erzeugt | Rolle `dashboard` (Datenbank `dashboard`) | Coolify-Variable, Dienste `postgres` und `renovate-dashboard` (Compose setzt daraus `DATABASE_URL`) | Wie oben mit `ALTER ROLE dashboard PASSWORD ...`, danach `renovate-dashboard` neu starten. |
| `AUTHELIA_SESSION_SECRET` | selbst erzeugt | Signiert Sitzungen | Coolify-Variable, Dienst `renovate-authelia` | Neu erzeugen, Redeploy; alle Sitzungen enden, Neuanmeldung nötig. |
| `AUTHELIA_STORAGE_ENCRYPTION_KEY` | selbst erzeugt | Verschlüsselt SQLite von Authelia (TOTP-Geheimnisse) | Coolify-Variable, Dienst `renovate-authelia` | Ein Wechsel macht die gespeicherten TOTP-Geräte unlesbar: Volume `authelia-data` leeren (oder Datenbank neu anlegen), Nutzerskript erneut ausführen, TOTP neu registrieren. |
| `AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET` | selbst erzeugt | JWT-Secret des deaktivierten Passwort-Resets (Authelia verlangt es trotzdem) | Coolify-Variable, Dienst `renovate-authelia` | Neu erzeugen, Redeploy; keine weiteren Folgen. |
