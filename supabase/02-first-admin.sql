-- FIRST: create/invite the account in Supabase Authentication > Users.
-- Replace ALL three values below. Run in SQL Editor as postgres.
-- This grants clinic admin access; it does not create an Auth password.
begin;
do $$
declare
  admin_email text := 'jhoneighteeth@gmail.com';
  admin_name text := 'Jhon';
  clinic_name text := 'Jhon Dental Clinic';
  admin_id uuid;
begin
  if admin_email like 'REPLACE_%' or admin_name like 'REPLACE_%'
     or clinic_name like 'REPLACE_%' then
    raise exception 'Replace the email, administrator name, and clinic name first.';
  end if;
  select id into admin_id from auth.users where lower(email) = lower(trim(admin_email));
  if admin_id is null then
    raise exception 'Create/invite this email in Authentication > Users first.';
  end if;
  update public.dental_clinic set name = clinic_name where id = true;
  if not found then raise exception 'Run 01-schema.sql first.'; end if;
  insert into public.dental_members (user_id, display_name, role)
  values (admin_id, admin_name, 'admin');
end;
$$;
commit;

select m.user_id, m.display_name, m.role, m.active
from public.dental_members m;
