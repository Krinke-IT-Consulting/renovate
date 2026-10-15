import { defineConfig } from "drizzle-kit";

// Nur für `npm run db:generate` (erzeugt SQL aus dem Schema, braucht keine Datenbank).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
