# Phase 2: Templates & Field Editor — Design

## Context

Phase 1 (documents, folders, PDF viewer) is merged and live. This is Phase 2 of the
same 5-phase local e-signature platform:

1. Documents, folders, PDF viewer (done)
2. **Template & field editor (drag-drop signature/form fields)** (this spec)
3. Recipients, signing session, signed-PDF generation
4. Audit trail / tamper-evidence, delivery methods (link/QR/SMTP)
5. Search/filter/duplicate/archive/export/print polish

This document covers Phase 2 only: placing signature/form fields on a PDF (either a
reusable Template or a specific Document), and managing a Templates library. No real
recipients, no sending, no signing yet — those are Phase 3.

## Goals

- Drag-and-drop placement of 5 field types onto any page of a PDF: Signature,
  Initials, Date Signed, Text, Checkbox.
- Fields are assigned to abstract "signer roles" (e.g. "Signer 1", "Signer 2",
  color-coded) rather than real people — Phase 3 will map real recipients onto these
  roles when sending.
- A **Template** is a first-class, reusable entity: its own PDF + field layout +
  signer roles, independent of any Document.
- The same field-editor UI and data model work on both a Template and a Document, so
  Phase 3's signing flow has something to sign against regardless of whether the
  document came from a template or was placed manually.
- "Use this template" instantiates a new Document from a Template, copying the PDF
  (via the existing content-addressed storage key — no file duplication) and
  duplicating the field/role layout onto the new document.
- A new "Templates" section in the app's navigation, separate from the Documents
  workspace.

## Non-goals (deferred to Phase 3+)

Real recipients (name/email), sending, signing sessions, signed-PDF generation, field
validation logic beyond a required/optional flag, additional field types (dropdown,
radio, attachment, stamp), folder organization for templates (flat list is enough for
a template library).

## Data model

```prisma
enum FieldType {
  SIGNATURE
  INITIALS
  DATE_SIGNED
  TEXT
  CHECKBOX
}

model Template {
  id               String   @id @default(cuid())
  title            String
  originalFilename String
  fileHash         String
  storageKey       String
  thumbnailKey     String?
  pageCount        Int
  fileSizeBytes    Int
  signerRoles      SignerRole[]
  fields           Field[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model SignerRole {
  id         String    @id @default(cuid())
  templateId String?
  template   Template? @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documentId String?
  document   Document? @relation(fields: [documentId], references: [id], onDelete: Cascade)
  name       String    // "Signer 1", "Signer 2", ...
  order      Int
  colorIndex Int       // index into a fixed client-side palette
  fields     Field[]
  createdAt  DateTime  @default(now())
}

model Field {
  id           String     @id @default(cuid())
  templateId   String?
  template     Template?  @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documentId   String?
  document     Document?  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  signerRoleId String
  signerRole   SignerRole @relation(fields: [signerRoleId], references: [id], onDelete: Cascade)
  type         FieldType
  page         Int        // 1-indexed
  x            Float      // fraction of page width, 0-1
  y            Float      // fraction of page height, 0-1
  width        Float      // fraction of page width
  height       Float      // fraction of page height
  required     Boolean    @default(true)
  label        String?    // optional prompt text, mainly for TEXT fields
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

`Document` (from Phase 1) gains `signerRoles SignerRole[]` and `fields Field[]` back-relations.

Both `SignerRole` and `Field` carry nullable `templateId`/`documentId` — exactly one
is set per row, enforced at the application layer (never both, never neither). This
lets one API surface and one editor component serve both owner types without
duplicating the schema. `Field.signerRoleId` is required (non-nullable) and always
points at a role belonging to the *same* owner (template or document) as the field
itself — enforced at the application layer when creating a field.

Coordinates are stored as fractions of page width/height (not pixels), so field
placement is resolution-independent and survives being rendered at any zoom level or
DPI, matching how Phase 1's viewer already renders pages at an arbitrary `scale`.

## Core flows

### Templates library
- New `/templates` route: grid of template cards (thumbnail, title, page count,
  signer-role count), an upload dropzone to create a new template (same PDF
  validation/hashing/thumbnailing pipeline as Phase 1's document upload, writing to
  the `Template` table instead of `Document`), and per-card rename/delete actions.
- Clicking a template card opens its field editor.

### Field editor
- Shared route pattern: `/templates/:id/edit` and `/documents/:id/edit`, both
  rendering the same `<FieldEditor ownerType="template" | "document" ownerId={id} />`
  component.
- Layout: a side panel with (a) the 5 field-type palette entries, draggable onto the
  page, and (b) the signer-role list as color-coded chips with an "+ Add signer role"
  button (auto-named "Signer N", auto-assigned the next color in a fixed palette).
  Main area renders every page of the PDF (reusing Phase 1's `pdfjs-dist` canvas
  rendering) with an absolutely-positioned overlay `<div>` per page holding that
  page's fields as colored boxes (color = assigned role's color).
- Drop a field type from the palette onto a page: creates a `Field` row via the API
  at a default size for that type, assigned to the currently-selected signer role
  (or the first role if none selected — a role is auto-created if the owner has zero
  roles yet).
- Drag an existing field to reposition, drag its corner handle to resize — both
  persist via a PATCH on drag-end/resize-end (not on every mousemove).
- Click a field to select it: shows a small inline toolbar to reassign its signer
  role (dropdown of existing roles) and toggle `required`; a delete (×) button on the
  box itself.
- All mutations are optimistic-then-persisted immediately (auto-save), the same
  pattern Phase 1 used for folders — no separate "Save" button.

Default field sizes (fraction of page width/height), tuned for a typical US-Letter or
A4 page:

| Field type   | width | height |
|---|---|---|
| SIGNATURE    | 0.25  | 0.06   |
| INITIALS     | 0.10  | 0.06   |
| DATE_SIGNED  | 0.15  | 0.04   |
| TEXT         | 0.20  | 0.04   |
| CHECKBOX     | 0.03  | 0.03   |

### Use this template
- A "Use this template" action on a template card: creates a new `Document` row
  reusing the template's `storageKey`/`thumbnailKey`/`fileHash`/`pageCount`/
  `fileSizeBytes` (content-addressed — the same PDF bytes, no file copy), title
  defaulted to the template's title, `status: DRAFT`, `folderId: null`. In the same
  transaction, duplicates the template's `SignerRole` rows (new IDs, same
  name/order/colorIndex) and `Field` rows (new IDs, same type/page/position/size/
  required/label, `signerRoleId` remapped to the new role IDs) onto the new document.
- Redirects to the new document's field editor so the user can adjust before moving
  on (Phase 3 will add sending from here).

### Document field editing entry point
- On the Phase 1 dashboard, a Draft-status document card gets an "Edit fields"
  action, routing to `/documents/:id/edit`.

## Error handling

- Field creation/update/delete follows the same `{error: string}` response-shape
  convention Phase 1 established across all routes.
- A field's `x`/`y`/`width`/`height` are clamped server-side to `[0, 1]` and to stay
  within the page bounds (`x + width <= 1`, `y + height <= 1`) — malformed client
  state can't corrupt stored coordinates.
- Deleting a `SignerRole` that still has fields assigned to it is rejected (400) if
  it's the last remaining role for that owner (a field must always have a role to
  belong to); otherwise its fields are reassigned to the next remaining role in
  `order`, mirroring Phase 1's folder-delete-reparents-children pattern.
- "Use this template" against a template with zero signer roles is rejected (400) —
  a template needs at least one role before it can be used.

## Testing

- Unit tests for coordinate clamping and the signer-role-reassignment-on-delete logic
  (pure functions, following Phase 1's `cycle-guard`/`build-tree` pattern).
- Integration tests (route handlers against real Postgres, following Phase 1's
  pattern): template upload, field CRUD on both owner types, signer-role CRUD
  including the "reassign fields when the assigned role is deleted" path, and the
  full "use this template" flow (verifying the new document's fields/roles are
  independent copies — mutating the document's fields must not affect the template's).
