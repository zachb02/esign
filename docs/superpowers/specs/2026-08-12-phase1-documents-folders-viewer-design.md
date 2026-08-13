# Phase 1: Documents, Folders & PDF Viewer — Design

## Context

This is Phase 1 of a locally-hosted electronic signature platform (a DocuSign-style
MVP that runs entirely on localhost, no auth/multi-tenancy/cloud). The full system
is being built in ordered phases, each with its own spec → plan → build cycle:

1. **Documents, folders, PDF viewer** (this spec)
2. Template & field editor (drag-drop signature/form fields)
3. Recipients, signing session, signed-PDF generation
4. Audit trail / tamper-evidence, delivery methods (link/QR/SMTP)
5. Search/filter/duplicate/archive/export/print polish

This document covers Phase 1 only: getting documents into the system, organizing
them, and viewing them. No signing, no fields, no recipients yet.

## Goals

- Launch straight into a dashboard (no login) showing a document list/grid.
- Upload one or more PDFs via drag-and-drop or file picker.
- Organize documents into a nested folder tree.
- View any document's pages in-browser, quickly, at high fidelity.
- Every document is hashed (SHA-256) on ingest so later phases can verify
  tamper-evidence without re-architecting storage.
- Storage is abstracted behind an interface so cloud storage can be added later
  without touching business logic.

## Non-goals (deferred to later phases)

Field placement/templates, recipients, signing sessions, audit trail UI, delivery
(link/QR/SMTP), search, duplicate, archive, export, print. The dashboard UI may show
greyed/disabled affordances for these so the shell reads complete, but none are
functional in Phase 1.

## Architecture

- **Next.js 15 (App Router)**, TypeScript, single codebase. `npm run dev` starts
  the whole app on localhost; app opens directly to `/dashboard`.
- **Prisma** ORM against a **local PostgreSQL** database (`esign_app`).
- **File storage**: filesystem, rooted at
  `~/Library/Application Support/esign-app/{documents,thumbnails}/`, kept entirely
  outside the git repository (never committed, survives repo re-clone/deletion).
  Accessed only through a `StorageAdapter` interface:
  ```ts
  interface StorageAdapter {
    save(key: string, data: Buffer): Promise<void>;
    read(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
  }
  ```
  A `LocalFsStorageAdapter` is the only implementation now; an `S3StorageAdapter`
  can be added later behind the same interface.
- **PDF rendering**: `pdfjs-dist` client-side for the in-browser viewer (page
  navigation, zoom). Server-side thumbnail generation on upload uses `pdfjs-dist`
  + `@napi-rs/canvas` to rasterize page 1 to a PNG — no external system binaries.
- **Git**: repo already initialized at `~/Documents/esign-app`, remote `origin` set
  to `https://github.com/zachb02/esign.git`. Commits happen at each meaningful
  milestone during implementation (no `Co-Authored-By` trailer, per user's
  established commit style).

## Data model

```prisma
model Folder {
  id        String   @id @default(cuid())
  name      String
  parentId  String?
  parent    Folder?  @relation("FolderTree", fields: [parentId], references: [id])
  children  Folder[] @relation("FolderTree")
  documents Document[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum DocumentStatus {
  DRAFT
  SENT
  IN_PROGRESS
  COMPLETED
  DECLINED
  EXPIRED
  ARCHIVED
}

model Document {
  id               String         @id @default(cuid())
  title            String
  folderId         String?
  folder           Folder?        @relation(fields: [folderId], references: [id])
  originalFilename String
  fileHash         String         // SHA-256 hex digest of the stored PDF
  storageKey       String         // key into StorageAdapter for the PDF
  thumbnailKey     String?        // key into StorageAdapter for the page-1 PNG
  pageCount        Int
  fileSizeBytes    Int
  status           DocumentStatus @default(DRAFT)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}
```

Status enum includes the full later-phase lifecycle now (`SENT`, `IN_PROGRESS`,
`COMPLETED`, `DECLINED`, `EXPIRED`, `ARCHIVED`) even though Phase 1 only ever
produces `DRAFT`, so the schema doesn't need a breaking migration when Phase 3/4
land.

## Core flows

### Upload
1. User drags PDF(s) onto the dashboard, or uses a file picker (multi-select
   supported).
2. Client validates file extension + MIME type before upload; server re-validates
   by checking the PDF magic bytes (`%PDF-`) regardless of client claims.
3. Server streams the file to `StorageAdapter.save()` under a content-addressed
   key, computes SHA-256 over the bytes, extracts page count via `pdfjs-dist`.
4. Server renders page 1 to a PNG thumbnail via `pdfjs-dist` + `@napi-rs/canvas`
   and saves it through the same adapter. If thumbnail generation throws, the
   upload still succeeds — `thumbnailKey` stays null and the UI shows a generic
   PDF icon; the failure is logged server-side, not surfaced as an upload error.
5. A `Document` row is created with `status: DRAFT`, `folderId` set to whatever
   folder was open (or null for the root).

### Folders
- Sidebar shows the folder tree (nested, arbitrary depth).
- Create / rename / delete folder. Deleting a non-empty folder prompts for
  confirmation and moves its contents to the parent (never silently deletes
  documents).
- Drag a document onto a folder to move it; drag a folder onto another folder to
  reparent it. A folder cannot be dropped into its own descendant (cycle guard).

### Viewer
- Clicking a document opens a full-page viewer rendering all pages client-side via
  `pdfjs-dist`, with page navigation and zoom controls. View-only — no field
  overlay yet (that's Phase 2).

### Dashboard list
- Grid/list view toggle. Each row/card shows thumbnail, title, status badge,
  folder breadcrumb, `updatedAt`. Sortable by title/date/status.

## Error handling

- Non-PDF or corrupt-PDF uploads are rejected with an inline toast; nothing is
  written to storage or the database for a rejected file.
- Thumbnail failures degrade gracefully (see Upload step 4) — never block the
  document from being usable.
- Storage adapter errors (disk full, permission denied) surface as a retry-able
  banner rather than crashing the upload flow or losing the in-flight file.
- Folder delete on a non-empty folder always confirms before acting; no silent
  data loss.

## Testing

- Unit tests for `StorageAdapter` (`LocalFsStorageAdapter`): save/read/delete/exists
  round-trip, including a stress case (very small and very large PDFs).
- Unit tests for upload validation (rejects non-PDF, rejects corrupt PDF, accepts
  valid PDF, hash is deterministic).
- Unit tests for folder tree operations, especially the reparent cycle guard.
- Integration test: upload → appears in dashboard list with correct status/thumbnail
  → move to folder → open viewer → renders correct page count.
