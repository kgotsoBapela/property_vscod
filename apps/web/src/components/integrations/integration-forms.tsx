"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Plus, Save, Trash2 } from "lucide-react";
import {
  INTEGRATION_CAPABILITIES,
  INTEGRATION_STATUS_LABELS,
  INTEGRATION_STATUSES,
  SUGGESTED_CREDENTIALS,
  type Integration,
  type IntegrationSecretMeta,
  type IntegrationUpdateInput,
} from "@propintel/shared";
import { Alert, Badge, Button, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/utils";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function AddIntegrationForm() {
  const router = useRouter();
  const [form, setForm] = useState({ display_name: "", provider_key: "", category: "property_data", website: "" });
  const m = useMutation({
    mutationFn: () => send("/api/admin/integrations", "POST", { ...form, website: form.website.trim() || null }),
    onSuccess: (created: { id: string }) => router.push(`/admin/integrations/${created.id}`),
  });
  return (
    <form
      className="grid gap-3 md:grid-cols-5 md:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Field id="new-name" label="Provider name">
        <Input
          id="new-name"
          required
          value={form.display_name}
          onChange={(e) => {
            const display_name = e.target.value;
            const slug = display_name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 41);
            setForm({ ...form, display_name, provider_key: form.provider_key && form.provider_key !== autoKey(form.display_name) ? form.provider_key : slug });
          }}
        />
      </Field>
      <Field id="new-key" label="Key (permanent)">
        <Input id="new-key" required value={form.provider_key} onChange={(e) => setForm({ ...form, provider_key: e.target.value })} />
      </Field>
      <Field id="new-cat" label="Category">
        <NativeSelect id="new-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          <option value="property_data">Property data</option>
          <option value="auctions">Auctions</option>
          <option value="sheriff_notices">Sheriff notices</option>
          <option value="gazette">Gazette</option>
        </NativeSelect>
      </Field>
      <Field id="new-web" label="Website">
        <Input id="new-web" type="url" placeholder="https://…" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
      </Field>
      <Button type="submit" disabled={m.isPending}>
        <Plus /> Add integration
      </Button>
      {m.isError && <p className="text-xs text-critical md:col-span-5">{(m.error as Error).message}</p>}
    </form>
  );
}

function autoKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 41);
}

const TEXT_FIELDS: { key: keyof IntegrationUpdateInput; label: string; hint?: string }[] = [
  { key: "auth_method", label: "Auth method", hint: "e.g. API key header, OAuth2 client credentials" },
  { key: "historical_coverage", label: "Historical coverage", hint: "e.g. transfers since 2000" },
  { key: "geographic_coverage", label: "Geographic coverage", hint: "e.g. all provinces; Gauteng only" },
  { key: "update_frequency", label: "Update frequency", hint: "e.g. daily after Deeds Office registration" },
  { key: "display_rights", label: "Display rights", hint: "What may be shown to the team" },
  { key: "retention_rights", label: "Retention rights", hint: "How long data may be stored" },
  { key: "contact_owner", label: "Contact owner", hint: "Who manages this provider relationship" },
];

const NUMBER_FIELDS: { key: "quota_per_day" | "cost_per_call_zar" | "monthly_cost_zar" | "max_paid_calls_per_job"; label: string; hint?: string }[] = [
  { key: "quota_per_day", label: "Quota per day (calls)" },
  { key: "cost_per_call_zar", label: "Cost per call (R)" },
  { key: "monthly_cost_zar", label: "Monthly cost (R)" },
  { key: "max_paid_calls_per_job", label: "Max paid calls per job", hint: "A sync stops when it reaches this cap" },
];

export function IntegrationEditForm({ integration, hasConnector }: { integration: Integration; hasConnector: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string | boolean | string[]>>(() => ({
    display_name: integration.display_name,
    status: integration.status,
    website: integration.website ?? "",
    notes: integration.notes ?? "",
    ...Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, (integration[f.key as keyof Integration] as string | null) ?? ""])),
    ...Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, integration[f.key] == null ? "" : String(integration[f.key])])),
    automated_refresh_permitted: integration.automated_refresh_permitted == null ? "unknown" : integration.automated_refresh_permitted ? "yes" : "no",
    capabilities: integration.capabilities,
  }));
  const [saved, setSaved] = useState(false);
  const str = (k: string) => String(form[k] ?? "");
  const nullable = (k: string) => (str(k).trim() === "" ? null : str(k).trim());
  const numberOrNull = (k: string) => (str(k).trim() === "" ? null : Number(str(k).replace(/[\s,]/g, "")));

  const m = useMutation({
    mutationFn: () =>
      send(`/api/admin/integrations/${integration.id}`, "PATCH", {
        display_name: str("display_name").trim(),
        status: form.status,
        website: nullable("website"),
        notes: nullable("notes"),
        ...Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, nullable(f.key)])),
        ...Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, numberOrNull(f.key)])),
        automated_refresh_permitted: form.automated_refresh_permitted === "unknown" ? null : form.automated_refresh_permitted === "yes",
        capabilities: form.capabilities,
      }),
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  const set = (k: string, v: string | boolean | string[]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field id="name" label="Provider name">
          <Input id="name" required value={str("display_name")} onChange={(e) => set("display_name", e.target.value)} />
        </Field>
        <Field id="status" label="Status" hint={hasConnector ? undefined : "Sandbox and Active need a connector, which this provider does not have yet."}>
          <NativeSelect id="status" value={str("status")} onChange={(e) => set("status", e.target.value)}>
            {INTEGRATION_STATUSES.map((s) => (
              <option key={s} value={s} disabled={!hasConnector && (s === "sandbox" || s === "active")}>
                {INTEGRATION_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="website" label="Website">
          <Input id="website" type="url" value={str("website")} onChange={(e) => set("website", e.target.value)} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">What this provider supplies</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {INTEGRATION_CAPABILITIES.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(form.capabilities as string[]).includes(c)}
                onChange={(e) => set("capabilities", e.target.checked ? [...(form.capabilities as string[]), c] : (form.capabilities as string[]).filter((x) => x !== c))}
              />
              {c.replaceAll("_", " ")}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Provider matrix. Leave blank when unknown; never guess.</div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TEXT_FIELDS.map((f) => (
            <Field key={f.key} id={f.key} label={f.label} hint={f.hint}>
              <Input id={f.key} value={str(f.key)} onChange={(e) => set(f.key, e.target.value)} />
            </Field>
          ))}
          {NUMBER_FIELDS.map((f) => (
            <Field key={f.key} id={f.key} label={f.label} hint={f.hint}>
              <Input id={f.key} inputMode="decimal" placeholder="Unknown" value={str(f.key)} onChange={(e) => set(f.key, e.target.value)} />
            </Field>
          ))}
          <Field id="refresh" label="Automated refresh permitted">
            <NativeSelect id="refresh" value={str("automated_refresh_permitted")} onChange={(e) => set("automated_refresh_permitted", e.target.value)}>
              <option value="unknown">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </NativeSelect>
          </Field>
        </div>
      </div>

      <Field id="notes" label="Notes">
        <textarea
          id="notes"
          rows={3}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={str("notes")}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={m.isPending}>
          <Save /> Save changes
        </Button>
        {saved && <span className="text-xs text-good">Saved.</span>}
        {m.isError && <span className="text-xs text-critical">{(m.error as Error).message}</span>}
      </div>
    </form>
  );
}

export function CredentialsPanel({ integrationId, secrets, demo }: { integrationId: string; secrets: IntegrationSecretMeta[]; demo: boolean }) {
  const router = useRouter();
  const [name, setName] = useState<string>("api_key");
  const [value, setValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => send(`/api/admin/integrations/${integrationId}/secrets`, "PUT", { name, value }),
    onSuccess: () => {
      setValue("");
      router.refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (n: string) => send(`/api/admin/integrations/${integrationId}/secrets?name=${encodeURIComponent(n)}`, "DELETE"),
    onSuccess: () => {
      setConfirmRemove(null);
      router.refresh();
    },
  });

  if (demo) return <Alert tone="demo">Credentials are stored in Supabase Vault, which is not available in demo mode.</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Values are encrypted in Supabase Vault and can never be viewed again, by anyone, in the app. Only the background worker reads them while
        syncing this provider. Requires two-factor sign-in. Every change is audited (without the value).
      </p>
      {secrets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No credentials stored.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {secrets.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <KeyRound className="size-4 text-muted-foreground" />
                <span className="font-mono">{s.name}</span>
                <Badge variant="muted">{s.hint ?? "set"}</Badge>
                <span className="text-xs text-muted-foreground">
                  set {fmtDateTime(s.set_at)}
                  {s.set_by_label ? ` by ${s.set_by_label}` : ""}
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setName(s.name)}>
                  Replace
                </Button>
                {confirmRemove === s.name ? (
                  <Button size="sm" variant="destructive" onClick={() => remove.mutate(s.name)} disabled={remove.isPending}>
                    Confirm remove
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(s.name)}>
                    <Trash2 /> Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] md:items-end"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field id="cred-name" label="Name">
          <Input id="cred-name" list="cred-suggestions" required value={name} onChange={(e) => setName(e.target.value.trim())} />
          <datalist id="cred-suggestions">
            {SUGGESTED_CREDENTIALS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field id="cred-value" label={secrets.some((s) => s.name === name) ? "New value (replaces the current one)" : "Value"}>
          <Input id="cred-value" type="password" autoComplete="new-password" required value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Button type="submit" disabled={save.isPending || !value}>
          <KeyRound /> Save credential
        </Button>
      </form>
      {(save.isError || remove.isError) && <p className="text-xs text-critical">{((save.error ?? remove.error) as Error).message}</p>}
    </div>
  );
}
