#!/usr/bin/env npx tsx
/**
 * run-migration.ts
 *
 * Runs the SQL migration file directly against Supabase Postgres.
 * Uses the service role key to derive the database connection.
 *
 * Run: npx tsx scripts/run-migration.ts
 */

import fs from "fs";
import path from "path";
import pg from "pg";

const MIGRATION_FILE = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "001_initial.sql"
);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }

  // Extract project ref from URL: https://<ref>.supabase.co
  const projectRef = new URL(url).hostname.split(".")[0];

  // Supabase Postgres connection via the pooler
  const connectionString = `postgresql://postgres.${projectRef}:${key}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

  console.log("Reading migration file...");
  const sql = fs.readFileSync(MIGRATION_FILE, "utf-8");
  console.log(`Migration: ${sql.length} bytes\n`);

  console.log("Connecting to Supabase Postgres...");
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("Connected. Running migration...\n");

    await client.query(sql);

    console.log("Migration completed successfully!");

    // Verify tables were created
    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log("\nTables in public schema:");
    for (const row of rows) {
      console.log(`  - ${row.table_name}`);
    }
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
