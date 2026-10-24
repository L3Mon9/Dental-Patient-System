# Supabase setup: one project per client

1. Create a **new Supabase project for each client**. Run `01-schema.sql` once in its SQL Editor as `postgres`. It uses a transaction and intentionally fails if these tables already exist; do not repeatedly run it or drop existing tables to resolve errors.
2. In Authentication settings, disable new public signups and anonymous sign-ins. Create/invite the clinic administrator through Authentication > Users. Configure the Site URL, allowed redirect URLs, and production SMTP for invitations and recovery emails.
3. Replace the three placeholders in `02-first-admin.sql`, then run that file. Unapproved Auth users have no access to clinic records. Role assignments do not come from user-editable metadata. Both clinic admins and dentists have clinical access; a clinic admin is different from the application's existing vendor owner.
4. Keep `dental_private` out of the Data API's exposed schemas. Keep `dental-imaging` private. Review the project's Storage upload limit: 128 MB files may require changing limits or plan. The bucket permits DICOM up to 128 MB; image metadata allows 2 MB images. Byte signatures and actual file size still need application/server validation.
5. Test with approved, suspended, and unapproved users using their actual sessions/publishable key. SQL Editor runs with elevated privileges and does not demonstrate RLS isolation. Disable membership with `update public.dental_members set active = false where user_id = 'USER_UUID';` in trusted SQL. Clinic suspension uses `update public.dental_clinic set active = false where id = true;`.

This creates an empty normalized database. The current React/Node app still uses SQLite. It needs Supabase Auth/session handling, patient/treatment/finding CRUD, Storage upload/download handling, and migration of existing records/files. SQL alone cannot make the existing app use Supabase. Do not copy the old password hashes or sessions; invite users through Supabase Auth.

Tables: `dental_clinic`, `dental_members`, `dental_patients`, `dental_treatments`, `dental_findings`, `dental_patient_files`, `dental_audit`.

Field mapping: patient `dob`, `phone`, `email`, `allergies`, `notes` map directly. Treatment `date` maps to `procedure_date`, `tooth` to `tooth_region`, `next` to `next_visit_date`, `nextProcedure` to `next_procedure`. Per-tooth `findingSelections` and `findingNotes` map to `conditions` and `notes`. Rebuild the display finding string from these values. Migrate old free-text findings into `notes`. Old string IDs may need UUID remapping.

Create a patient before uploading. Upload to `dental-imaging` using `<patient UUID>/<random UUID>.<extension>`, without upsert, then insert its metadata in `dental_patient_files`. Store object paths, not public or signed URLs. Use authenticated downloads or short-lived signed URLs. Existing signed URLs can remain valid until expiry after suspension. Upload + metadata insert is not atomic; implement controlled orphan cleanup. Do not delete Storage objects by deleting SQL rows; use the Storage API from a trusted backend.

Browser clients have no hard-delete permissions. Use patient archiving. Record updates are audited by row ID and actor; this is not full clinical amendment history, a read/download audit, or tamper-proof logging against database administrators. This baseline does not implement concurrency conflict detection; add revision-checked writes when connecting the app to preserve its current stale-save protection. New clinical data should be tested with synthetic records first.

Use the project URL and publishable key in the frontend. Never expose the secret/service-role key or database password. Privileged keys bypass RLS, so do not use them for ordinary patient requests. Configure MFA, HTTPS, off-site recovery, and a restore drill before real patient data. Database backups do not back up Storage object bytes; back up those separately.

Official references:
- https://supabase.com/docs/guides/auth/managing-user-data
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/platform/backups
