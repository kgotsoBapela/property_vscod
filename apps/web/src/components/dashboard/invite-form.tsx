"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ROLE_LABELS, type Role } from "@propintel/shared";
import { Button, Input, Label, NativeSelect } from "@/components/ui/primitives";

export function InviteForm({ allowedRoles }: { allowedRoles: Role[] }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(allowedRoles[0]!);
  const m = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Invite failed");
    },
    onSuccess: () => setEmail(""),
  });
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
      <Button type="submit" disabled={m.isPending}>
        Send invitation
      </Button>
      {m.isSuccess && <p className="text-xs text-good">Invitation sent.</p>}
      {m.isError && <p className="text-xs text-critical">{(m.error as Error).message}</p>}
    </form>
  );
}
