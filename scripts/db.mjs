#!/usr/bin/env node
/**
 * Run SQL against the Supabase Postgres database.
 *
 *   npm run db:run -- supabase/bonus-tiers-migration.sql
 *   npm run db:query -- "select count(*) from bonus_tiers"
 *
 * Reads SUPABASE_DB_URL from .env.local (gitignored). That URL carries the
 * database password, so it is never printed — only the host is echoed, so a
 * shared terminal or a pasted log cannot leak it.
 *
 * A .sql file is sent as ONE simple query, which Postgres runs inside a
 * single implicit transaction: a migration that fails halfway rolls back
 * whole instead of leaving the schema half-applied.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — fall through to the check below, which explains the fix.
}

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error(
    [
      "Missing SUPABASE_DB_URL.",
      "",
      "Supabase Dashboard -> Project Settings -> Database -> Connection string",
      "-> URI (Session pooler). Copy it, replace [YOUR-PASSWORD] with the DB",
      "password, and put it in .env.local:",
      "",
      '  SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"',
      "",
      ".env.local is gitignored, so it never leaves this machine.",
    ].join("\n")
  );
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const argument = rest.join(" ").trim();

if (!command || !argument || !["run", "query"].includes(command)) {
  console.error(
    "Usage:\n  npm run db:run -- <path/to/file.sql>\n  npm run db:query -- \"<sql>\""
  );
  process.exit(1);
}

const sql =
  command === "run" ? readFileSync(resolve(argument), "utf8") : argument;

/** Turn a Postgres error `position` (a byte offset) into a line number. */
function lineForPosition(text, position) {
  const offset = Number(position);
  if (!Number.isFinite(offset) || offset <= 0) return null;
  return text.slice(0, offset).split("\n").length;
}

const client = new pg.Client({
  connectionString,
  // Supabase terminates SSL at the pooler with its own CA, which is not in
  // Node's trust store. The connection is still encrypted.
  ssl: { rejectUnauthorized: false },
  // A long migration should not die on the default socket timeouts.
  statement_timeout: 5 * 60 * 1000,
});

try {
  await client.connect();
  console.log(`Connected to ${client.host}`);

  const started = Date.now();
  const result = await client.query(sql);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // A multi-statement file comes back as an array of results, one per
  // statement; a single query comes back as one object.
  const results = Array.isArray(result) ? result : [result];
  const rows = results.flatMap((r) => r?.rows ?? []);

  if (rows.length > 0) {
    console.table(rows.slice(0, 50));
    if (rows.length > 50) console.log(`… ${rows.length - 50} more rows`);
  }

  console.log(
    `OK — ${results.length} statement${results.length === 1 ? "" : "s"} in ${elapsed}s`
  );
} catch (err) {
  const line = lineForPosition(sql, err.position);
  console.error(`\nFAILED: ${err.message}`);
  if (err.detail) console.error(`Detail: ${err.detail}`);
  if (err.hint) console.error(`Hint: ${err.hint}`);
  if (line && command === "run") console.error(`At ${argument}:${line}`);
  console.error("Nothing was applied — the whole file ran in one transaction.");
  process.exitCode = 1;
} finally {
  await client.end();
}
