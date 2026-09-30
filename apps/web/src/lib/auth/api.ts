import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConflictError, NotAllowedError } from "@/lib/data/types";
import { HttpError } from "./session";

/** Wraps a route handler so auth, validation and conflict errors map to proper HTTP responses. */
export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const result = await fn();
    return result instanceof NextResponse ? result : NextResponse.json(result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof NotAllowedError) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof ConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
