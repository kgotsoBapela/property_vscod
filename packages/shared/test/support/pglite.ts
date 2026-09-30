import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SqlExec } from "../../src/sync/sql-store";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "supabase");

/** Minimal stand-in for the Supabase-managed pieces the migrations depend on. */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(join(ROOT, "migrations")).sort()) {
    await db.exec(readFileSync(join(ROOT, "migrations", f), "utf8"));
  }
  await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated, service_role;`);
  await db.exec(readFileSync(join(ROOT, "seed.sql"), "utf8"));
  const exec: SqlExec = async (sql, params) => (await db.query(sql, params as unknown[])).rows as never;
  return { db, exec };
}

/** Run a callback as an authenticated user with RLS enforced. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
