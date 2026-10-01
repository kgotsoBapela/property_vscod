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
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated, service_role;

  -- Supabase Vault stand-in (same call signatures; no encryption in tests).
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
    language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
  create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null) returns void
    language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name) where id = secret_id $$;
  create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret from vault.secrets;
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

/** Run a callback as an authenticated user with RLS enforced. `aal` mirrors the JWT's MFA assurance level. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>, aal: "aal1" | "aal2" = "aal1"): Promise<T> {
  const claims = JSON.stringify({ sub: userId, aal });
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false); select set_config('request.jwt.claims', '${claims}', false);`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claims', '', false);`);
  }
}
