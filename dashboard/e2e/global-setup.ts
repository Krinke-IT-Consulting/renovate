import { recreateDatabase, seed } from "./db";

export default async function globalSetup() {
  await recreateDatabase();
  await seed();
}
