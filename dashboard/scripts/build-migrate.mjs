// Bündelt den Migrations-Runner samt Abhängigkeiten (drizzle-orm, pg) zu dist/migrate.js,
// damit das Image dafür kein node_modules braucht. Aufruf: npm run build:migrate
import { build } from "esbuild";

await build({
  entryPoints: ["src/db/migrate-cli.ts"],
  outfile: "dist/migrate.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // pg lädt pg-native optional per try/require; ohne die Bibliothek fällt es auf JS zurück.
  external: ["pg-native"],
  tsconfig: "tsconfig.json",
  logLevel: "info",
});
