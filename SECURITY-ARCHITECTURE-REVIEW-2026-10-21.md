# Security and architecture review

Review date: 21 October 2026 (Asia/Singapore). Scope: current working-tree application and proposed Supabase SQL. Decision: **not ready for production patient information**.

This is an evidence-based engineering review, not a claim of regulatory certification or a completed penetration test. No application code, existing database, existing records, or Supabase project was changed during this review. This report is the only project file added. Limited API probes used newly created synthetic accounts and an isolated temporary SQLite database on a separate localhost port. That temporary database was retained; no existing data was deleted. No migrations were applied.

## Scope and confidence

Reviewed authentication/session handling, all Node API routes, SQLite DDL, owner bootstrap, React session/data handling, imaging import and viewer, proposed Supabase schema/grants/RLS/storage policies, provisioning SQL, documentation, dependency manifest, and integration test coverage.

Evidence is classified as **confirmed by isolated test**, **confirmed by source inspection**, or **deployment verification required**. The real Supabase catalog, deployed policies, Auth settings, actual Storage permissions, hosting configuration, disk encryption/ACLs, secret management, backups, and restore history were not available for inspection. SQL files do not prove what is deployed. Existing patient records and credentials were not read. Current uncommitted changes, including user changes, were preserved.

`npm audit --omit=dev --json` returned zero known production dependency vulnerabilities. This is a registry advisory result for the current dependency tree, not proof that parsers/codecs are safe or that development/build dependencies have been audited.

## Architecture and trust boundaries

**Current application:** browser → same-origin `/api` → custom Node server → SQLite database. Passwords, session hashes, clinic membership, all clinic patient records, DICOM bytes, and audit events live in one SQLite file. Each clinic's clinical records are a single JSON document. Ordinary images are base64 strings in that document; DICOM files are separate BLOB rows. The browser receives the full clinic document, not just the selected patient's record.

The owner dashboard provisions clinics and dentist credentials. Patient/file API access uses the authenticated user's server-side clinic ID. The owner is blocked from patient APIs, but an operator with access to the database/server can read the data. UI role restrictions are not a security boundary against infrastructure administrators.

**Proposed Supabase architecture:** a separate project for each client, Supabase Auth users, explicitly approved memberships, normalized clinical tables, and private object storage. The SQL has no tenant/clinic ID on patient rows: every active admin/dentist in that project shares its clinical workspace. That is consistent with one project per clinic, but cannot safely serve unrelated clients in a shared project.

**Integration gap:** the React app and Node routes still use SQLite and custom sessions. There is no Supabase runtime integration in `src/api.js`, `server.mjs`, or the dependency manifest. Executing the SQL cannot switch authentication, transfer data, or connect these architectures. SQLite's vendor `owner` role and Supabase's clinical `admin` role have different privileges and must not be mapped blindly.

## Prioritized findings

No unauthenticated critical patient-data disclosure was demonstrated in this review. The high-severity findings below are production blockers. There is also a **conditional critical isolation risk** if the single-clinic Supabase schema is reused for multiple unrelated clients.

### R1 — High: whole-clinic overwrite can erase clinical records

Evidence: `server.mjs:87`, `src/App.jsx:24`. Confirmed in the isolated test: `PUT /api/records` with the current revision and `patients: []` returned 200 and removed all synthetic patients from the active record document. Any authorized dentist account for that clinic can do this. Removing an individual patient or treatment from the submitted document has the same replacement semantics.

The revision check prevents stale writes, but does not distinguish an intentional amendment from accidental omission or mass deletion. There is no record history or recoverable application-level deletion. The previous JSON body is overwritten. The generated Supabase schema blocks browser DELETE, but UPDATE still permits replacing clinical text and has no historical versions.

Plan: move to patient-level transactional writes; prohibit destructive replacement through routine save; implement controlled archiving, amendment history, actor/reason metadata, and revision checks. Preserve the existing data before any migration.

### R2 — High: incomplete server validation permits persistent malformed records

Evidence: `server.mjs:54`, `server.mjs:86`, `server.mjs:87`, `src/App.jsx:36`, `src/dicom.js`. Confirmed: a patient with `treatments: [null]` and an object-valued tooth finding was accepted with 200. These shapes violate UI assumptions such as reading treatment properties and rendering findings as text; they can break a patient's workspace on subsequent load. This is a data-integrity/availability finding, not a demonstrated XSS exploit.

Nested treatment/image/finding fields, IDs, dates, text lengths, allowed keys, and per-patient item counts are incompletely validated. Some invalid root shapes produce 500 instead of 400; JSON `null` on login was confirmed to do so. Clinic updates coerce arbitrary truthy values into `active = true` and do not verify that a target row exists.

The proposed SQL improves types, FKs, status and tooth constraints, but leaves unbounded narrative/metadata fields and allows callers to supply creation timestamps on INSERT. A DEFAULT is not a restriction on client-supplied values. There is no version precondition for concurrent Supabase updates.

Plan: strict request/response schemas and bounded fields; reject malformed inputs before persistence; enforce date/ID/status constraints; control audit timestamps on the server; add optimistic concurrency to normalized writes. Do not silently repair or discard existing clinical content during validation rollout.

### R3 — High: uploaded content and patient linkage are insufficiently verified

Evidence: `server.mjs:67`, `server.mjs:73`, `server.mjs:81`, `server.mjs:87`, `src/useImagingImport.js:28`, `supabase/01-schema.sql:71`, `supabase/01-schema.sql:202`.

Confirmed: a 132-byte buffer containing only `DICM` at offset 128 was accepted with 201. The server does not validate an actual DICOM dataset, image dimensions, transfer syntax, or decoded size. Ordinary images are checked by data-URL prefix and string length rather than validating decoded image bytes. Browser checks can be bypassed through direct API requests.

SQLite file rows identify a clinic but not a patient. The same uploaded file was successfully linked to two synthetic patients. This does not cross a clinic boundary, but permits accidental clinical misattribution. An uploaded file remains stored even if the user never saves its patient link.

Proposed Storage policies verify membership and an existing patient folder, which is useful. However, metadata inserts do not verify that an object exists or that its size/MIME/digest matches. The bucket allows 128 MB for every allowed MIME type, while the metadata table says ordinary images are at most 2 MB. A client can upload a larger image without creating a metadata row. MIME declarations alone do not validate bytes. Storage upload and metadata INSERT are separate operations.

Plan: use a patient-bound staged upload process, validate actual bytes and bounded decoding in an isolated worker, enforce quotas, verify object metadata/checksums, then mark the attachment available. Audit attachment creation/reassignment and require explicit handling of identity mismatches. Cleanup must honor retention and legal-hold rules and requires separate approval before deleting existing objects.

### R4 — High: account lifecycle and revocation are incomplete

Evidence: `server.mjs:57`, `server.mjs:61`, `server.mjs:62`, `server.mjs:64`, `src/Portal.jsx:9`. Confirmed: submitting the temporary password as the new password clears the forced-change flag. The supplier-known credential therefore remains usable despite the UI promise.

Confirmed: clinic suspension blocks logout with 403 because the suspension check executes first. React clears session and patient state only after successful logout, leaving the patient workspace visible after this failure. Reactivation restores the old unexpired session because suspension does not revoke it. Already-rendered information cannot be recalled by server access checks alone.

Sessions have an eight-hour absolute expiry, but no idle lock, session inventory, individual-user deactivation, or expiry cleanup. There is no implemented MFA, account recovery, or secure invitation lifecycle. Temporary passwords do not expire. The proposed SQL also does not enforce MFA assurance; that must be added deliberately if MFA is required.

Plan: secure invitations/recovery; enforce a genuinely changed password during transition; allow logout regardless of suspension; clear local sensitive state on logout/auth failure; revoke sessions on deactivation and credential compromise; add idle locking and MFA for administrators, with an agreed clinician policy. Expired/suspended sessions should be tested in every patient and imaging flow.

### R5 — High when internet-facing: production transport protection is optional

Evidence: `server.mjs:41`, `server.mjs:57`, `server.mjs:91`, `README.md:38`. The Node listener is HTTP and defaults to loopback, which is suitable for local development. Session cookies have HttpOnly and SameSite=Strict, but Secure is enabled only when `COOKIE_SECURE=1`. The isolated default configuration issued a cookie without Secure. No production startup guard enforces TLS deployment requirements.

No deployed HTTPS/proxy configuration was inspected, so this is not a claim that a production endpoint currently exposes traffic. Public deployment without TLS would expose credentials and clinical traffic. Content Security Policy and HSTS are not set in the application; an external proxy could supply them, but that is unverified.

Plan: explicit production mode, HTTPS ingress, Secure cookies, trusted-proxy rules, strict production origins, and tested security headers. Introduce CSP in report-only mode first and account for the local DICOM/WASM workers. Keep Vite development/preview servers out of production hosting.

### R6 — High: recovery and data protection are documented, not demonstrated

Evidence: `README.md:34`, `README.md:38`, `supabase/README.md`. The documented SQLite backup procedure is a manual copy with the server stopped. There is no repository evidence of automated backup jobs, monitoring, protected off-site copies, retention, restore drills, or agreed recovery objectives. External backups may exist; they were not verified.

The application adds no database-file encryption or restrictive file permissions itself. Protection depends on host volume encryption, OS ACLs, operator access, and backup encryption, none of which were inspected. `.gitignore` excludes `data/`, but exclusion from Git is not encryption or access control.

Plan: agree acceptable data loss and recovery time; configure encrypted, access-controlled backups and isolated restore drills; verify SQLite snapshot/WAL consistency during transition. Back up Supabase Storage bytes separately: database backups include object metadata, not uploaded object contents. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)

### R7 — High: audit trails cannot reconstruct important clinical or security events

Evidence: `server.mjs:17`, `server.mjs:38`, `server.mjs:57`, `server.mjs:76`, `server.mjs:87`, `supabase/01-schema.sql:96`, `supabase/01-schema.sql:139`, `supabase/01-schema.sql:189`.

SQLite logs selected events such as successful login and a generic clinic-wide save. It does not record patient-level reads/downloads, failed authentication, logout, access denials, or which record/fields changed. Several state changes commit before their audit INSERT; audit failure can return 500 after data was already changed. There is no protected export/retention or tamper detection against the server's DB access.

Supabase row triggers are transactionally coupled to clinical writes, an improvement. They log row identity and action, not clinical revision history. Membership and clinic suspension changes have no audit trigger. SQL/service operations may have null `auth.uid()` and need an explicit trusted operator attribution mechanism. Reads/downloads require application or platform logging; row triggers do not capture SELECT.

Plan: atomic clinical amendments plus security events, request IDs, subject identifiers, outcomes, and controlled retention. Keep clinical history in access-controlled clinical tables; do not place raw health details, passwords, or tokens in general logs. Protect audit access and forward security events to a separately controlled destination. [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

### R8 — High architecture risk; conditional critical cross-client exposure

Evidence: `supabase/01-schema.sql:10`, `supabase/01-schema.sql:113`, `supabase/01-schema.sql:185`. The SQL deliberately permits every active project member with admin/dentist role to access every patient in that project. There is no per-client tenant field or predicate.

With one correctly isolated project per clinic this is not a cross-tenant RLS defect. If accounts from unrelated clients are provisioned into the same project, they will share clinical access by design. The current owner dashboard's multi-clinic concept must not be ported into this schema unchanged.

Plan: enforce one project/deployment per client in provisioning and configuration validation. Separate vendor administration from clinic clinical roles. Do not give the vendor an automatic clinical admin membership. Any support access needs explicit scope, expiry, and audit. Use a separate vendor registry for billing/deployment identifiers if needed, without patient records or pooled client secrets exposed to browser code.

### R9 — Medium–High: denial-of-service and scaling controls are weak

Evidence: `server.mjs:31`, `server.mjs:39`, `server.mjs:54`, `server.mjs:57`, `server.mjs:70`, `server.mjs:87`. Password hashing, SQLite queries, JSON parsing, and many file operations are synchronous. JSON requests may buffer 24 MB before authentication and DICOM uploads buffer up to 128 MB plus copies. There are no aggregate concurrency, storage, study-size, or per-clinic quotas. No load/DoS tests were run against a live server.

The login limiter is an in-memory map keyed only by socket peer IP. It resets on restart, is not shared among instances, and never removes expired entries. Behind a reverse proxy, clients can share one peer IP and trigger a shared login lockout. Password change is not similarly rate limited. Different hash work for known and unknown emails also warrants timing-enumeration testing.

The full clinic JSON, including embedded images, must fit the 24 MB save limit. A clinic can grow to a point where routine saves fail, well before 10,000 patients. Opening one patient still transfers all clinic records into browser memory.

Plan: smaller endpoint-specific payload limits, early authentication, bounded asynchronous hashing/workers, proxy-aware durable throttling, quotas and bounded imaging jobs; paginated patient queries and external object storage. Tune password hashing with explicit, versioned parameters and a rehash policy if custom auth is retained; prefer the planned managed Auth lifecycle. [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

### R10 — Medium: errors and session expiry are not handled consistently

Evidence: `src/api.js:4`, `src/Portal.jsx:8`, `src/Portal.jsx:9`, `src/useImagingImport.js:29`, `src/DicomViewer.jsx:29`, `server.mjs:89`. The generic API wrapper now handles invalid JSON, but upload code still parses JSON directly. General API requests have no timeout. Initialization swallows authenticated record-loading failures as if there were simply no session and can leave an indefinite loading screen. No shared mechanism handles 401/403 by locking the clinical workspace and preserving unsaved work safely.

The server generally hides internal exception text from clients, which is positive, but only uses raw console errors for diagnostics and has no correlation IDs or structured redaction. The DICOM viewer handles local failures, but explicit verification of decoded-image cache cleanup at logout is missing.

Plan: typed error responses and request IDs, consistent timeout/retry behavior, explicit expired/suspended states, and protected recovery of unsaved changes. Do not automatically retry non-idempotent uploads or mutations without idempotency keys. Test cache and memory lifecycle without adding patient data to localStorage.

### R11 — Medium: configuration and delivery controls need formalization

Evidence: `.gitignore`, `package.json`, `supabase/02-first-admin.sql`, `supabase/README.md`. `.env` and `.env.production` are not explicitly ignored; `*.local` does not cover them. No secret value was found or exposed by this review, but future Supabase credentials need explicit safeguards. The first-admin SQL currently contains a client-specific email/name rather than a reusable deployment template; it should not accidentally provision the same operator into another client's project.

There is no reviewed CI pipeline for policy tests, migration checks, restore verification, or secret scanning. The monolithic compressed server routes make security review and maintenance harder. The SQL scripts are one-time initialization, not a versioned upgrade/migration strategy.

Plan: secrets manager/environment separation, preventive secret scanning, parameterized provisioning with a target-project check, versioned migrations and schema drift detection, and separation of auth/validation/storage/audit handlers. No credential rotation is proposed unless exposure is established or required by the rollout.

## Supabase RLS and storage assessment

The proposed baseline has useful protections: RLS on all seven public tables; explicit removal of anon/PUBLIC table grants; no browser membership mutation; active member and active clinic checks; fixed empty search paths on SECURITY DEFINER helpers; private bucket; patient-folder checks; no browser hard-delete or object-overwrite policy; constrained patient relationships and identity-preserving update trigger.

The self-membership SELECT remains available to the user even when suspended; that reveals their own membership, not patient rows. The private helper accepts roles as an argument, but the ordinary clinical policies use the fixed default admin/dentist set; this alone is not a role-escalation vulnerability. The helper intentionally avoids recursive membership RLS. Do not add FORCE RLS blindly without testing that design.

Required verification before deployment:

- Inspect actual `pg_policies`, grants, function owners/EXECUTE privileges, exposed schemas, views, buckets, Auth settings, and Security Advisor results. Additional permissive policies can broaden access; this script does not remove unknown existing policies.
- Test anonymous, unapproved, active, suspended, and deleted users through actual Data/Storage APIs with ordinary user tokens. SQL Editor's privileged role is not an RLS acceptance test.
- Verify MFA enforcement at the database and storage boundary, not just the UI. The current script contains no assurance-level check. [Supabase MFA guidance](https://supabase.com/docs/guides/auth/auth-mfa)
- Restrict administrative secrets to isolated trusted operations. Privileged secret/service-role requests can bypass RLS; normal patient requests should carry the validated user's authorization. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Test rejected uploads to missing/wrong patient folders, unauthenticated object fetches, overwrites, metadata/object inconsistencies, and signed-URL expiry. A private bucket does not validate medical content. [Supabase Storage guidance](https://supabase.com/docs/guides/storage/security/access-control)
- Verify the live project's upload limits, network access, TLS settings, backups, and monitoring rather than assuming defaults. [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)

## Existing controls worth preserving

Prepared SQL statements for user input; server-derived clinic scope; owner denied patient access; no public signup endpoint; local-only initial owner provisioning with an atomic duplicate-owner check; random session tokens stored as SHA-256 digests; salted scrypt password hashes; HttpOnly/SameSite cookies; password-change revocation of other sessions; temporary-password gate on clinical APIs; no-store on API/file responses; exact-origin mutation checks; stale-save revision check; image types restricted away from arbitrary HTML/SVG data URLs; no patient storage in localStorage found (only display preferences). These reduce risk, but do not establish production readiness.

## Isolated evidence summary

All probes below used synthetic data in a newly created temporary database. No production/live Supabase policies were executed.

| Probe | Observed result |
|---|---|
| Unauthenticated patient request | 401 |
| Public account setup | 403 |
| Temporary-password account requests records | 403 |
| Set new password equal to temporary password | 200; reset gate cleared |
| Save malformed treatment/finding structure | 200 |
| Replace current patient document with empty array | 200; zero records remain in synthetic document |
| Upload only DICM marker without an image dataset | 201 |
| Link one uploaded file to two patients in the same clinic | 200 |
| Logout while clinic is suspended | 403 |
| Reuse old session after clinic reactivation | 200 |
| Submit JSON null to login | 500 |
| Default login cookie with COOKIE_SECURE unset | Secure absent |
| npm production dependency audit | Zero known advisories reported |

Existing integration tests cover clinic isolation, owner restrictions, password gate, stale-save rejection, suspension, and logout. Those tests were inspected; their previous passing results do not replace the missing Supabase, recovery, abuse, and lifecycle acceptance tests.

## Proposed implementation sequence and approval gates

**Phase 1 — Preserve and inventory.** After plan approval, establish the client/project mapping, hosting and secret inventory, encrypted consistent backups, and an isolated restore. Record counts/checksums without copying patient details into reports. Agree recovery time/data-loss targets, operator access, retention, and applicable privacy obligations. Confirm actual Supabase state using read-only inspection before designing updates to it.

**Phase 2 — Contain immediate application risks.** Implement strict nested validation, prevent accidental record omissions, fix password-change and logout/revocation behavior, enforce production transport settings, bounded requests/throttling, structured errors, and idle-lock behavior. Add regression tests for each confirmed finding against synthetic data. Keep existing records intact; report legacy invalid records for controlled review instead of overwriting them.

**Phase 3 — Prepare the target design and migration package.** Use one Supabase project per client with a separate application deployment and Supabase Auth. Route clinical operations through a user-scoped server/API where validation, reads/download audit, idempotency, and upload processing can be enforced. Retain RLS as a second authorization boundary. Restrict direct table writes to the chosen safe operations/RPCs so validation/auditing cannot simply be bypassed via the Data API. Keep service-role credentials out of ordinary request paths. Add versioned clinical amendments, atomic audit, trusted timestamps, role/MFA policies, verified attachments, quotas, and retention states. Prepare migration and rollback scripts without applying them.

**Approval gate A:** present exact schema/grant/policy changes, target project identifiers, expected impact, backup verification, dry-run plan, and rollback procedure. Wait for explicit approval before applying ANY database migration, including staging migrations. The existing initialization script must not be run against an unknown populated project.

**Phase 4 — Execute an approved isolated rehearsal.** Apply only approved migrations to the approved staging project. Import a copy with stable old/new ID mappings and checksums; invite users through managed Auth rather than copying old sessions/hashes. Reconcile patients, procedures, findings, and attachment bytes and links. Test all deny cases using real user-role sessions, two completely separate client projects, concurrent saves, malformed uploads, session expiry, and restored backups. Record failures and resolve them before cutover.

**Approval gate B:** obtain explicit approval for production migration/cutover and for any deletion, overwrite, archival change, or cleanup of existing data. Use an agreed write-freeze window, verified final snapshot, reconciliation, and a rollback plan that accounts for new writes. Preserve the source database as a protected recovery copy; do not delete it as part of cutover.

**Phase 5 — Operate and review.** Enable monitoring for auth failures, unusual downloads, storage growth, failed backups, and audit gaps. Schedule restore exercises and access reviews. Maintain documented incident response, recovery, retention, and client handover procedures.

Production acceptance requires: no unapproved user or unrelated client can access records/files; MFA/session policies work at enforcement boundaries; invalid records/files cannot persist; routine saves cannot silently erase clinical history; changes and required reads/downloads are attributable; backups restore both database and image bytes within agreed objectives; and every deployed project matches the approved policy/schema version.

**Approval status:** report delivered; implementation has not started. All migrations and destructive changes remain pending the user's explicit approval.
