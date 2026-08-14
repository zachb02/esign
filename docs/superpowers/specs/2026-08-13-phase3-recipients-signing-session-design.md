# Phase 3: Recipients, Signing Session & Signed-PDF Generation — Design

## Context

Phases 1 (documents, folders, PDF viewer) and 2 (templates, drag-and-drop field editor)
are merged and live. This is Phase 3 of the same 5-phase local e-signature platform:

1. Documents, folders, PDF viewer (done)
2. Template & field editor (done)
3. **Recipients, signing session, signed-PDF generation** (this spec)
4. Audit trail / tamper-evidence, delivery methods (link/QR/SMTP)
5. Search/filter/duplicate/archive/export/print polish

This document covers Phase 3 only: assigning real recipients to a document's signer
roles, letting each recipient open a signing session and fill in their fields, and
producing the final flattened signed PDF once everyone finishes. No email delivery,
no QR codes, no audit trail, no sequential signing order — those are later phases.

## Goals

- A "Send" flow that assigns a name/email to each of a document's signer roles and
  generates an unguessable per-recipient signing link.
- A public signing session (`/sign/:token`) where a recipient fills in only the
  fields assigned to their role: draws a signature/initials, types text, checks
  boxes. Date Signed fields are auto-filled by the app at completion time, not typed
  by the recipient.
- Recipients may complete OR decline their signing session.
- All recipients signing in parallel (any order) — no enforced sequence.
- Once every recipient completes, the app flattens all field values onto the
  original PDF (pdf-lib) to produce the final signed PDF, and the document becomes
  `COMPLETED`.
- `Document.status` (already defined in Phase 1's schema, unused until now) actually
  drives through its real lifecycle: `DRAFT → SENT → IN_PROGRESS → COMPLETED`, or
  `→ DECLINED` if any recipient declines.
- Once a document leaves `DRAFT`, its fields/signer-roles can no longer be edited
  (a lightweight version of "prevent modification of completed signed documents").

## Non-goals (deferred to Phase 4+)

Email sending, QR code generation, "copy signing link" polish beyond a plain copy
button, sequential/ordered signing, tamper-evident audit logs, IP/browser tracking,
document hashing/cryptographic verification of signed output, typed
(font-rendered) signatures, expiring links (`EXPIRED` status stays unused for now).

## Data model

```prisma
enum RecipientStatus {
  PENDING
  SIGNED
  DECLINED
}

model Recipient {
  id            String          @id @default(cuid())
  documentId    String
  document      Document        @relation(fields: [documentId], references: [id], onDelete: Cascade)
  signerRoleId  String
  signerRole    SignerRole      @relation(fields: [signerRoleId], references: [id], onDelete: Cascade)
  name          String
  email         String
  signingToken  String          @unique
  status        RecipientStatus @default(PENDING)
  signedAt      DateTime?
  declinedAt    DateTime?
  declineReason String?
  fieldValues   FieldValue[]
  createdAt     DateTime        @default(now())
}

model FieldValue {
  id                String    @id @default(cuid())
  fieldId           String    @unique
  field             Field     @relation(fields: [fieldId], references: [id], onDelete: Cascade)
  recipientId       String
  recipient         Recipient @relation(fields: [recipientId], references: [id], onDelete: Cascade)
  textValue         String?
  checked           Boolean?
  signatureImageKey String?
  dateValue         DateTime?
  filledAt          DateTime  @default(now())
}
```

`Document` gains `recipients Recipient[]` and `completedPdfKey String?`. `SignerRole`
gains a `recipients Recipient[]` back-relation. `FieldValue.fieldId` is `@unique` —
one value per field, since a field belongs to exactly one signer role, which maps to
exactly one recipient per document. Values live in a table separate from `Field`
(rather than columns on `Field`) so `Field` stays owner-agnostic (Template fields
never have values) and a value's lifecycle (created at signing time) stays distinct
from a field's lifecycle (created at editing time).

Signature images are stored via a new `getSignatureStorage()` adapter (same
`StorageAdapter` interface, third directory: `~/Library/Application Support/esign-app/signatures/`),
matching the original spec's explicit "local filesystem for signatures" requirement.

## Core flows

### Send
- `POST /api/documents/:id/send`: body is `{ assignments: [{ signerRoleId, name, email }] }`,
  one entry per signer role on the document. Rejects (400) if any role is missing an
  assignment, if the document isn't `DRAFT`, or if the document has zero fields.
  Creates one `Recipient` per assignment with a cryptographically random
  `signingToken` (e.g. 32 bytes, base64url), sets `Document.status = SENT`.
  Returns the created recipients including their tokens so the UI can build
  `/sign/:token` links.
- `/documents/:id/send` page: a form pre-listing each existing signer role (by name)
  with name/email inputs, submits to the above route, then displays each generated
  link with a copy-to-clipboard button. No email is sent.

### Signing session
- `GET /api/sign/:token`: looks up the `Recipient` by token (404 if not found).
  Returns the document's file info, the recipient's own fields (via
  `signerRoleId`) with any existing `FieldValue`s (so a partially-filled session can
  resume), and the recipient's current `status`. If `status` is already `SIGNED` or
  `DECLINED`, the page renders a read-only confirmation instead of an editable form.
- `PATCH /api/sign/:token/fields/:fieldId`: upserts a `FieldValue` for one field —
  JSON body for `TEXT`/`CHECKBOX` (`{ textValue }` / `{ checked }`), multipart body
  for `SIGNATURE`/`INITIALS` (a PNG blob from the signature-pad canvas, stored via
  `getSignatureStorage()`). Rejects (400) if the field doesn't belong to this
  recipient's role, or if the recipient's session is already `SIGNED`/`DECLINED`.
- `POST /api/sign/:token/complete`: validates every `required: true` field owned by
  this recipient has a `FieldValue` (400 listing which are missing, if not). Any
  `DATE_SIGNED` field owned by this recipient gets a `FieldValue` auto-created with
  today's date. Sets `Recipient.status = SIGNED`, `signedAt = now()`. If this was
  the last `PENDING` recipient for the document, triggers PDF flattening (see
  below) and sets `Document.status = COMPLETED`; otherwise sets
  `Document.status = IN_PROGRESS` (if not already).
- `POST /api/sign/:token/decline`: body `{ reason?: string }`. Sets
  `Recipient.status = DECLINED`, `declinedAt = now()`, and immediately sets
  `Document.status = DECLINED` (a decline blocks the document from ever completing).

### PDF flattening
- `src/lib/pdf/flatten.ts`: a pure-ish module (PDF buffer + list of `{field, value}`
  pairs in → new PDF buffer out) using `pdf-lib`, mirroring how `render.ts` and
  `clamp.ts` are independently testable. For each field with a value, converts its
  stored fractional `x`/`y`/`width`/`height` to PDF points for that page (flipping
  the y-axis, since PDF page coordinates originate at the bottom-left) and draws:
  - `SIGNATURE`/`INITIALS`: the stored signature PNG, scaled to the field's box.
  - `TEXT`: the stored string, in a standard font sized to fit the field height.
  - `CHECKBOX`: a checkmark glyph if `checked`, nothing otherwise.
  - `DATE_SIGNED`: the auto-filled date string.
  Called once, server-side, when the last recipient completes. The output is saved
  via `getDocumentStorage()` under a fresh content-addressed key and recorded as
  `Document.completedPdfKey`.
- `GET /api/documents/:id/file` (existing Phase 1 route) is modified to serve
  `completedPdfKey` when present, falling back to the original `storageKey`
  otherwise — so Phase 1's PDF viewer automatically shows the signed version once a
  document completes, with no new route or client change needed.

### Locking non-Draft documents
- `POST/PATCH/DELETE` on `/api/fields`, `/api/fields/:id`, `/api/signer-roles`,
  `/api/signer-roles/:id` all reject (400) when the target Field/SignerRole's owning
  `Document.status` is not `DRAFT` (Templates are unaffected — they have no
  `status`). The `/documents/:id/edit` page itself also redirects to the dashboard
  (or shows a read-only notice) when the document isn't `DRAFT`.

### Dashboard visibility
- `DocumentGrid`'s summary type gains `recipientCount`/`signedCount`, shown as a
  small "2 of 3 signed" hint next to the status badge when status is `SENT` or
  `IN_PROGRESS` — directly serves the original brief's "track document progress"
  requirement using data this phase already has, without building a full activity
  timeline (that's Phase 4).

## Error handling

- All new routes follow the existing `{ error: string }` convention.
- A signing token that doesn't match any `Recipient` returns 404 on every `/sign/:token*`
  route — no information leakage about whether a document/recipient exists.
- Completing or declining an already-`SIGNED`/`DECLINED` recipient is rejected (400)
  — a session can only be finalized once.
- Completing or declining is also rejected (400) if the document's status is
  already `DECLINED` (a sibling recipient declined first) — a still-`PENDING`
  recipient's session becomes read-only ("this document was declined by another
  signer") rather than allowing a completion that could no longer matter.
- Sending a document with zero fields, or with any signer role missing an
  assignment, is rejected (400) before any `Recipient` rows are created.
- If PDF flattening throws (a corrupt stored signature image, an unexpected
  pdf-lib error), the triggering `complete` request still marks the recipient
  `SIGNED` but the document stays `IN_PROGRESS` with the error logged — a completed
  recipient's session must never be lost or left in limbo because of a downstream
  rendering failure; flattening can be retried by contacting the app owner (no
  retry UI in this phase).

## Testing

- Unit tests for `flatten.ts` (pdf-lib output — assert output byte size, page
  count, and PNG magic bytes are present when a signature is drawn — mirroring
  `render.test.ts`'s approach of asserting real, non-trivial output rather than
  just "didn't throw").
- Integration tests (route handlers against real Postgres, following the
  established pattern): send-flow validation (missing assignment rejected, zero
  fields rejected), full signing session lifecycle for a single recipient
  (field values save and resume, required-field validation on complete, decline
  path), and the multi-recipient completion path (first recipient completes →
  `IN_PROGRESS`; last recipient completes → `COMPLETED` + `completedPdfKey` set +
  `/api/documents/:id/file` now serves the flattened PDF). Also a test confirming
  field/signer-role mutation routes reject once a document leaves `DRAFT`.
