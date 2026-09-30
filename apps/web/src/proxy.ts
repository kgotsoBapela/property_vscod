import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie and does an optimistic redirect to sign-in.
 * Real authorization happens in server components, route handlers and RLS.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next(); // demo mode

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });
  const path = request.nextUrl.pathname;
  // If Supabase fell back to the Site URL with a PKCE code, forward it to the callback instead of dropping it.
  if (request.nextUrl.searchParams.has("code") && path !== "/auth/callback") {
    const target = new URL("/auth/callback", request.url);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target);
  }
  const { data } = await supabase.auth.getUser();
  const isPublic = ["/sign-in", "/forgot-password", "/reset-password", "/auth/"].some((p) => path.startsWith(p));
  if (!data.user && !isPublic && !path.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
