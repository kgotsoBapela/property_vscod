import Link from "next/link";

export const metadata = { title: "Not permitted" };

export default async function ForbiddenPage(props: PageProps<"/forbidden">) {
  const sp = await props.searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role lacks the required permission{typeof sp.need === "string" ? ` (${sp.need})` : ""}. Ask a Super Admin if you need it.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-primary hover:underline">
          Back to overview
        </Link>
      </div>
    </div>
  );
}
