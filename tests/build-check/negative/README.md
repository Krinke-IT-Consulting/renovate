# Negativbeispiele für den Build-Check

Diese Projekte sind absichtlich kaputt. Der Selbsttest (`test-build-check.yml`) nutzt sie **nicht**,
denn ein Workflow kann den erwarteten Fehlschlag eines Reusable-Workflow-Aufrufs nicht als Erfolg
werten. Sie werden einmalig auf einem Test-Branch geprüft (OpenSpec-Change `build-check`, Task 4.3).

| Ordner | Erwarteter Fehlschlag |
|---|---|
| `lockfile-mismatch` | Job `node`, Schritt „Install (eingefrorene Lockfile)“: `npm ci` meldet, dass `package.json` und Lockfile nicht zusammenpassen |
| `red-test` | Job `node`, Schritt „Tests“: der Test schlägt fehl |
| `python-syntax` | Job `python`, Schritt „Quellen kompilieren“: `broken.py` hat einen Syntaxfehler |
| `empty-project` | Job `Erkennung`: „Nichts Prüfbares gefunden“ |

Aufruf je Fall: `build-check.yml` mit `working-directory: tests/build-check/negative/<ordner>`.
