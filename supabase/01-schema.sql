-- Run ONCE in a NEW Supabase project's SQL Editor as postgres.
-- One project = one client clinic. Do not run against an existing production schema.
-- This prepares the database; it does not migrate SQLite data or connect the app.
begin;

create schema if not exists dental_private;
revoke all on schema dental_private from public, anon, authenticated;
grant usage on schema dental_private to authenticated;

create table public.dental_clinic (
  id boolean primary key default true check (id),
  name text not null check (length(trim(name)) between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.dental_clinic (name) values ('My Dental Clinic');

-- Auth manages passwords. Never store passwords in these tables.
-- Memberships are provisioned by trusted SQL/server administration only.
create table public.dental_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  role text not null check (role in ('admin', 'dentist')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.dental_patients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  dob date,
  phone text not null default '',
  email text not null default '',
  allergies text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dental_treatments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.dental_patients(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 300),
  procedure_date date not null default current_date,
  tooth_region text not null default '',
  status text not null default 'Planned'
    check (status in ('Planned', 'In progress', 'Completed')),
  notes text not null default '',
  next_procedure text not null default '',
  next_visit_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dental_findings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.dental_patients(id) on delete restrict,
  tooth smallint not null check (
    tooth between 11 and 18 or tooth between 21 and 28 or
    tooth between 31 and 38 or tooth between 41 and 48
  ),
  conditions text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, tooth)
);

-- Store binary data in Storage, not in Postgres rows or base64 data URLs.
create table public.dental_patient_files (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.dental_patients(id) on delete restrict,
  storage_path text not null unique,
  original_name text not null,
  category text not null check (category in (
    'Periapical X-ray', 'Panoramic X-ray', 'Cephalometric X-ray',
    'Clinical photograph', 'CBCT (DICOM)'
  )),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'application/dicom'
  )),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 134217728),
  captured_on date not null default current_date,
  dicom_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(dicom_metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = patient_id::text),
  check (length(split_part(storage_path, '/', 2)) > 0),
  check (mime_type = 'application/dicom' or size_bytes <= 2097152),
  check (category <> 'CBCT (DICOM)' or mime_type = 'application/dicom')
);

-- Change metadata only: no patient names, notes, or passwords in this log.
-- This is not a log of reads, downloads, or clinical amendment history.
create table public.dental_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  created_at timestamptz not null default now()
);

create index dental_patients_name_idx on public.dental_patients (name);
create index dental_treatments_patient_idx on public.dental_treatments (patient_id);
create index dental_treatments_next_idx on public.dental_treatments (next_visit_date)
  where next_visit_date is not null;
create index dental_patient_files_patient_idx on public.dental_patient_files (patient_id);
create index dental_audit_created_idx on public.dental_audit (created_at);

-- Private helper avoids recursive membership policies and ignores editable JWT metadata.
create function dental_private.has_access(allowed_roles text[] default array['admin', 'dentist'])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.dental_members m
    cross join public.dental_clinic c
    where m.user_id = (select auth.uid())
      and m.active and c.active and m.role = any(allowed_roles)
  );
$$;
revoke all on function dental_private.has_access(text[]) from public, anon, authenticated;
grant execute on function dental_private.has_access(text[]) to authenticated;

create function dental_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or
     (to_jsonb(new)->'patient_id') is distinct from (to_jsonb(old)->'patient_id') then
    raise exception 'Record identity and patient assignment cannot be changed.';
  end if;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function dental_private.touch_updated_at() from public, anon, authenticated;

create function dental_private.log_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.dental_audit (actor_id, table_name, row_id, action)
  values (auth.uid(), tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end, tg_op);
  return null;
end;
$$;
revoke all on function dental_private.log_change() from public, anon, authenticated;

-- Explicitly remove default API grants before allowing the required operations.
revoke all on public.dental_clinic, public.dental_members,
  public.dental_patients, public.dental_treatments, public.dental_findings,
  public.dental_patient_files, public.dental_audit from public, anon, authenticated;
revoke all on sequence public.dental_audit_id_seq from public, anon, authenticated;

alter table public.dental_clinic enable row level security;
alter table public.dental_members enable row level security;
alter table public.dental_patients enable row level security;
alter table public.dental_treatments enable row level security;
alter table public.dental_findings enable row level security;
alter table public.dental_patient_files enable row level security;
alter table public.dental_audit enable row level security;

grant select on public.dental_clinic, public.dental_members, public.dental_audit to authenticated;
grant select, insert, update on public.dental_patients,
  public.dental_treatments, public.dental_findings to authenticated;
grant select, insert on public.dental_patient_files to authenticated;

create policy dental_clinic_read on public.dental_clinic
  for select to authenticated using ((select dental_private.has_access()));
create policy dental_members_read on public.dental_members
  for select to authenticated using (
    user_id = (select auth.uid()) or
    (select dental_private.has_access(array['admin']))
  );
create policy dental_audit_read on public.dental_audit
  for select to authenticated using ((select dental_private.has_access(array['admin'])));

-- All approved clinicians in THIS client's project share its patient workspace.
-- No browser deletes; archive patients instead. No browser role changes.
do $$
declare table_name text;
begin
  foreach table_name in array array['dental_patients', 'dental_treatments', 'dental_findings'] loop
    execute format('create policy dental_read on public.%I for select to authenticated using ((select dental_private.has_access()))', table_name);
    execute format('create policy dental_insert on public.%I for insert to authenticated with check ((select dental_private.has_access()))', table_name);
    execute format('create policy dental_update on public.%I for update to authenticated using ((select dental_private.has_access())) with check ((select dental_private.has_access()))', table_name);
    execute format('create trigger dental_touch before update on public.%I for each row execute function dental_private.touch_updated_at()', table_name);
    execute format('create trigger dental_log after insert or update or delete on public.%I for each row execute function dental_private.log_change()', table_name);
  end loop;
end;
$$;

create policy dental_files_read on public.dental_patient_files
  for select to authenticated using ((select dental_private.has_access()));
create policy dental_files_insert on public.dental_patient_files
  for insert to authenticated with check ((select dental_private.has_access()));
create trigger dental_files_log after insert or update or delete on public.dental_patient_files
  for each row execute function dental_private.log_change();

-- The project's Storage global upload limit must also allow your DICOM sizes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dental-imaging', 'dental-imaging', false, 134217728,
  array['image/jpeg', 'image/png', 'image/webp', 'application/dicom']);

-- Path: <patient UUID>/<random file UUID>.<extension>
-- No UPDATE/DELETE policies: upload new objects without upsert/overwrite.
create policy dental_storage_read on storage.objects
  for select to authenticated using (
    bucket_id = 'dental-imaging'
    and (select dental_private.has_access())
    and exists (select 1 from public.dental_patients p
      where p.id::text = (storage.foldername(storage.objects.name))[1])
  );
create policy dental_storage_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'dental-imaging'
    and (select dental_private.has_access())
    and exists (select 1 from public.dental_patients p
      where p.id::text = (storage.foldername(storage.objects.name))[1])
  );

commit;
