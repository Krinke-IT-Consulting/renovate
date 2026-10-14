const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Client } = require("pg");

test("SELECT 1 gegen DATABASE_URL", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL ist nicht gesetzt");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query("SELECT 1 AS one");
    assert.equal(res.rows[0].one, 1);
  } finally {
    await client.end();
  }
});
