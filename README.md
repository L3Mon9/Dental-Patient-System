# Jhon Dental Clinic application

A full-width React application with a local Node API and SQLite database.

## Run

Requires Node 22.17 or newer with `node:sqlite` available. Node 24 LTS is recommended for the current imaging codec dependencies.

```powershell
npm.cmd run build
npm.cmd start
```

Open http://127.0.0.1:3001. Keep the server terminal running.

For development, run `npm.cmd run server` in one terminal and `npm.cmd run dev` in another. Open the Vite URL.

## First use

1. Create your system owner account on first launch. There are no default credentials.
2. From Clinic administration, create a clinic and dentist account with a temporary password of at least 12 characters.
3. Give those credentials to the dentist directly. Sign out and sign in with that account to use the clinic workspace.
4. The dentist must change the temporary password before accessing patients.
5. Add patients, enter findings on the FDI chart, upload images, and record procedures with next-procedure dates.
6. Use Edit details under Overview to update a patient. Follow-ups lists next-visit dates for the selected patient. Text size controls at the bottom offer Compact, Comfortable, Large, and Extra large; this preference is stored only in the browser.
7. Click **Save changes** in the top bar to persist edits. The status shows unsaved edits. Reloading discards unsaved edits.

The owner can suspend clinic access. Owner accounts cannot read patient records through the records API. Each dentist account is scoped to its clinic by the server. Concurrent stale saves are rejected rather than overwriting newer records.

## Data and scope

SQLite files are stored in `data/`, excluded from Git. Images are currently embedded in each clinic's record document: JPG, PNG, WebP up to 2 MB each, with a 24 MB request limit. This is an initial local application, not a scalable image archive. Back up the data directory with the server stopped. Do not place it in a public web directory.

3D CBCT reconstruction/MPR, clinical prescription printing, billing, automated appointment reminders, invitation email, password recovery, staff roles, per-surface charting, and formal record amendment workflows are not implemented. DICOM Part 10 files can be imported through Imaging (128 MB each), stored as protected SQLite BLOBs, and opened under Viewer. The viewer uses Cornerstone for 2D single-image and multi-frame stack display with series selection, frame navigation, pan, zoom, invert, rotation, window/level controls, reset, and fullscreen. Multi-file scans are grouped by Series Instance UID and ordered by Instance Number, then filename. This is not geometry-based 3D reconstruction. Scanner-specific compatibility still needs validation with actual clinic exports. ZIP imports are not supported. Uploaded files are linked to the patient only after Save changes; abandoned uploads remain stored and currently need administrative cleanup. File upload/download access is clinic scoped. The tooth chart currently supports permanent dentition and a text finding per tooth.

Before using real patient data or exposing the system publicly, configure HTTPS, `COOKIE_SECURE=1`, protected hosting and backups, access/recovery procedures, and an appropriate clinical/privacy review. The default server binds only to localhost. This build has not undergone a production security audit.

Development requests from http://localhost:5173 and http://127.0.0.1:5173 are allowed. For a custom frontend origin, set `APP_ORIGINS` to a comma-separated list of exact origins. Restart the API after changing configuration. Other cross-origin mutations are rejected.

Environment variables: `PORT` (3001), `HOST` (127.0.0.1), `DENTELLE_DATA_DIR` (project data directory), `COOKIE_SECURE` (set to 1 with HTTPS).

## Validation

```powershell
npm.cmd run build
npm.cmd run lint
node server.test.mjs
```

The integration test uses a temporary database. It checks provisioning, temporary-password enforcement, record persistence, tenant isolation, stale-save rejection, clinic suspension, owner restrictions, and logout.


## Browser checks

Run node viewer.test.mjs to test a synthetic two-frame DICOM file in installed Chrome, viewer controls, patient editing and database save, persistent text sizes, and mobile overflow. The test uses temporary accounts and a temporary database; screenshots are written to qa/. Change the Chrome executable path in that test when running on another machine. Imaging codecs and compatibility shims are bundled locally; files are not sent to a third-party viewer.


## Patient navigation and CBCT imports

Dentists land on a patient directory after login. Selecting a patient or adding a new patient opens that patient's full-width dashboard and hides the directory. Use Back to patients to choose another record. Unsaved edits stay in memory when returning to the directory; use Save changes to persist them.

Selecting CBCT (DICOM) changes the file picker and upload instructions to DICOM. Uploads are checked for a DICOM Part 10 header; ordinary images are rejected in CBCT mode. Other imaging categories continue to accept supported images and DICOM files. The browser integration test covers landing/selection, hiding other names, adding a patient, rejecting a PNG in CBCT mode, and saving a DICOM attachment under the correct patient.

## CBCT folders

Under a patient's Imaging section, select CBCT (DICOM), then Choose CBCT folder. The browser includes subfolders. The app detects DICOM Part 10 headers (including extensionless files), skips DICOMDIR and non-DICOM files, and skips duplicate SOP Instance UIDs already attached or repeated within the batch. It reads metadata before uploading and shows one review for the batch. If multiple patient identities are found, select the correct group; other groups are not imported.

After import the app opens Viewer on the new CT series with the most frames (or the largest imported series when none is CT). This remains a 2D stack viewer, not a 3D reconstruction. The imaging library groups slices into one series card. Use Save changes to persist the patient links. Import progress and per-file failures are displayed; a partially successful batch opens the successfully imported images and reports failures.

Patient names are decoded using supported declared DICOM character sets, including UTF-8 and Latin-1. Unsupported or invalid text is shown as unavailable for review rather than guessed. The screenshot's garbled source name cannot be guaranteed recoverable without a supported, correctly declared encoding.

Validation: node dicom.test.mjs checks name decoding; node viewer.test.mjs covers nested folders, duplicate detection, cancel-before-upload, mixed-patient review, automatic series selection, and frame navigation. Set TEST_DEV=1 to run the same browser flow against an isolated Vite development server.
