"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { ROLE_LABELS, type Role } from "@propintel/shared";
import { Button, Input, Label, NativeSelect } from "@/components/ui/primitives";

export function InviteForm({ allowedRoles }: { allowedRoles: Role[] }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(allowedRoles[0]!);
  const [delivery, setDelivery] = useState<"email" | "link">("email");
  const [copied, setCopied] = useState(false);
  const m = useMutation({
    mutationFn: async (): Promise<{ share_link: string | null }> => {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role, delivery }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Invite failed");
      return body;
    },
    onSuccess: () => {
      setEmail("");
      setCopied(false);
    },
  });
  const link = m.data?.share_link ?? null;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="role">Role</Label>
        <NativeSelect id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Delivery</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="delivery" checked={delivery === "email"} onChange={() => setDelivery("email")} className="mt-1" />
          <span>
            Send invitation email
            <span className="block text-xs text-muted-foreground">Corporate email scanners may open and use up the link.</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="delivery" checked={delivery === "link"} onChange={() => setDelivery("link")} className="mt-1" />
          <span>
            Create a link to share
            <span className="block text-xs text-muted-foreground">No email is sent. Share the one-time link privately (e.g. Teams).</span>
          </span>
        </label>
      </fieldset>
      <Button type="submit" disabled={m.isPending}>
        {delivery === "email" ? "Send invitation" : "Create invite link"}
      </Button>
      {m.isSuccess && !link && <p className="text-xs text-good">Invitation sent.</p>}
      {link && (
        <div className="flex flex-col gap-2 rounded-md border p-3 text-xs">
          <span className="font-medium">One-time invite link (shown once; valid for a limited time):</span>
          <code className="break-all rounded bg-muted p-2">{link}</code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            <Copy /> {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      )}
      {m.isError && <p className="text-xs text-critical">{(m.error as Error).message}</p>}
    </form>
  );
}
