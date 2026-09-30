import postgres from "postgres";
import type { SqlExec } from "@propintel/shared";

export function connect(url: string) {
  // The Supabase pooler (transaction mode) does not support prepared statements.
  const sql = postgres(url, { max: 5, prepare: false, idle_timeout: 30, connect_timeout: 15 });
  const exec: SqlExec = async (text, params = []) => (await sql.unsafe(text, params as never[])) as never;
  return { sql, exec };
}
