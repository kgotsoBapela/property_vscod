-- Integration administration and provider credentials.
-- Credential VALUES live only in Supabase Vault (encrypted). This table holds metadata (name, when, by whom).
-- Only a Super Admin signed in with MFA (aal2) can set or remove credentials; only the service role (worker)
-- can read decrypted values. Browsers and Admins/Viewers can never read them.

create table public.integration_secrets (
  integration_id uuid not null references public.integrations (id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{1,40}$'),
  vault_secret_id uuid not null,
  hint text, -- e.g. "…a3f9" for long values; never the value itself
  set_by uuid references auth.users (id),
  set_at timestamptz not null default now(),
  primary key (integration_id, name)
);
alter table public.integration_secrets enable row level security;
create policy integration_secrets_read on public.integration_secrets for select to authenticated
  using (public.has_role('super_admin'));

-- Super Admin can add providers and change what they support (RLS already allows updating integrations).
create policy integrations_create on public.integrations for insert to authenticated
  with check (public.has_role('super_admin') and is_demo = false and status = 'candidate');
create policy capabilities_manage on public.integration_capabilities for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

create or replace function public.require_super_admin_mfa() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('super_admin') then
    raise exception 'Only a Super Admin can manage credentials' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Two-factor sign-in is required to manage credentials' using errcode = '42501';
  end if;
end $$;

create or replace function public.set_integration_secret(p_integration_id uuid, p_name text, p_value text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare
  v_existing uuid;
  v_vault_name text := 'integration:' || p_integration_id || ':' || p_name;
begin
  perform public.require_super_admin_mfa();
  if p_name !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'Invalid credential name' using errcode = '22023';
  end if;
  if p_value is null or length(p_value) = 0 or length(p_value) > 8192 then
    raise exception 'Credential value must be 1 to 8192 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.integrations where id = p_integration_id) then
    raise exception 'Integration not found' using errcode = 'P0002';
  end if;

  select vault_secret_id into v_existing from public.integration_secrets where integration_id = p_integration_id and name = p_name;
  if v_existing is not null then
    perform vault.update_secret(v_existing, p_value);
  else
    v_existing := vault.create_secret(p_value, v_vault_name, 'Provider credential (managed by the app)');
  end if;

  insert into public.integration_secrets (integration_id, name, vault_secret_id, hint, set_by, set_at)
  values (p_integration_id, p_name, v_existing,
          case when length(p_value) >= 16 then '…' || right(p_value, 4) else null end, auth.uid(), now())
  on conflict (integration_id, name) do update
    set vault_secret_id = excluded.vault_secret_id, hint = excluded.hint, set_by = excluded.set_by, set_at = excluded.set_at;

  perform public.write_audit('integration.secret_set', p_integration_id::text, jsonb_build_object('name', p_name));
end $$;

create or replace function public.delete_integration_secret(p_integration_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare
  v_id uuid;
begin
  perform public.require_super_admin_mfa();
  delete from public.integration_secrets where integration_id = p_integration_id and name = p_name returning vault_secret_id into v_id;
  if v_id is null then
    raise exception 'Credential not found' using errcode = 'P0002';
  end if;
  begin
    delete from vault.secrets where id = v_id;
  exception when insufficient_privilege then
    -- Fall back to overwriting the stored value if this role cannot delete Vault rows.
    perform vault.update_secret(v_id, '', 'deleted:' || v_id);
  end;
  perform public.write_audit('integration.secret_deleted', p_integration_id::text, jsonb_build_object('name', p_name));
end $$;

-- Worker only: decrypted credentials for one integration as {name: value}.
create or replace function public.get_integration_secrets(p_integration_id uuid) returns jsonb
language sql stable security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(s.name, d.decrypted_secret), '{}'::jsonb)
    from public.integration_secrets s
    join vault.decrypted_secrets d on d.id = s.vault_secret_id
   where s.integration_id = p_integration_id
$$;

revoke execute on function public.require_super_admin_mfa() from public, anon;
revoke execute on function public.set_integration_secret(uuid, text, text) from public, anon;
revoke execute on function public.delete_integration_secret(uuid, text) from public, anon;
revoke execute on function public.get_integration_secrets(uuid) from public, anon, authenticated;
grant execute on function public.require_super_admin_mfa() to authenticated;
grant execute on function public.set_integration_secret(uuid, text, text) to authenticated;
grant execute on function public.delete_integration_secret(uuid, text) to authenticated;
grant execute on function public.get_integration_secrets(uuid) to service_role;
