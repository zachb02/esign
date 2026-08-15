# Phase 4: Audit Trail & Delivery Methods — Design

**Status:** Approved
**Date:** 2026-08-14

## Goal

Add a tamper-evident audit trail to the signing process, and give documents a
permanent home for recipient status, signing links, QR codes, and optional
email delivery — closing the Phase 3 backlog gap where signing links became
unrecoverable once the Send page was left.

## Architecture

A new `AuditEvent` model, hash-chained per document, fed by a single
`recordAuditEvent()` helper called from the existing signing-session routes
(view, field-fill, sign, decline, complete) plus new send/email routes. A new
`/documents/[id]` detail page becomes the permanent home for recipient
status, signing links, QR codes, email actions, and the audit trail.
`flattenPdf()` gains a final step appending a Certificate of Completion page
to the signed PDF.

## Data Model

```prisma
enum AuditEventType {
  SENT
  VIEWED
  FIELD_FILLED
  SIGNED
  DECLINED
  COMPLETED
  EMAIL_SENT
}

model AuditEvent {
  id            String          @id @default(cuid())
  documentId    String
  document      Document        @relation(fields: [documentId], references: [id], onDelete: Cascade)
  recipientId   String?
  recipient     Recipient?      @relation(fields: [recipientId], references: [id], onDelete: SetNull)
  type          AuditEventType
  detail        String?
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime        @default(now())
  contentHash   String
  prevHash      String?
}
```

- `contentHash` = SHA-256 of `documentId + recipientId + type + detail + createdAt.toISOString() + prevHash`.
- `prevHash` = the `contentHash` of the previous `AuditEvent` row for the same
  document, ordered by `createdAt`/`id`; `null` for the first event on a
  document.
- `recordAuditEvent(tx, { documentId, recipientId?, type, detail?, ipAddress?, userAgent? })`
  runs inside the same Prisma transaction as the state change it logs (e.g.
  inside `complete/route.ts`'s existing transaction). It reads the
  document's latest `AuditEvent` row (within the transaction) to compute
  `prevHash`, so an audit event can never be committed for a state change
  that itself did not commit.
- `recipientId` is nullable because `SENT` and document-level `COMPLETED`
  events are not tied to one recipient.
- `verifyAuditChain(documentId)` walks a document's events in order,
  recomputing each `contentHash` from its stored fields and comparing
  against the stored `prevHash` chain, and returns either "verified" or the
  index of the first broken link. Used by the detail page (a "chain
  verified ✓" / "⚠ chain broken at event N" indicator) and by a test that
  tampers a row directly via Prisma and confirms detection.

## Event Capture Points

All via `recordAuditEvent()`, all within the route's existing transaction
where one exists:

| Route | Event | Notes |
|---|---|---|
| `POST /api/documents/[id]/send` | `SENT` | document-level, `recipientId: null` |
| `GET /api/sign/[token]` | `VIEWED` | once per recipient — skip if a `VIEWED` event already exists for that recipient, to avoid a noisy event per page reload/poll |
| `PATCH /api/sign/[token]/fields/[fieldId]` | `FIELD_FILLED` | `detail` = field label or type |
| `POST /api/sign/[token]/complete` | `SIGNED` (per recipient) + `COMPLETED` (document-level, only if this was the last recipient) | |
| `POST /api/sign/[token]/decline` | `DECLINED` | `detail` = decline reason |
| `POST /api/documents/[id]/recipients/[recipientId]/email` | `EMAIL_SENT` | `detail` = recipient email address |

IP address and user agent are read from the incoming request
(`x-forwarded-for` / `user-agent` headers) at each signing-session route.
Document-management-only events (there are none beyond `SENT`, which
originates from the app operator's own browser, not a recipient) do not
need this metadata.

## Certificate of Completion Page

`flattenPdf()` (`src/lib/pdf/flatten.ts`) gains an optional final step,
invoked only from `complete/route.ts` once the last recipient finishes:
`appendCertificatePage(pdfDoc, events, recipients)` in the same module draws
a plain page listing each recipient (name, email, role), their
SIGNED/DECLINED timestamp and IP address, and a summary line: "Audit trail
verified — chain hash: `<first 12 chars>…<last 12 chars>`". This is pure
pdf-lib drawing using the same font/encoding constraints already enforced
elsewhere in this module (`isTextFlattenable`). If it throws, the whole
completion transaction rolls back — consistent with Phase 3's precedent
that a signed PDF is never shipped in a partially-generated state.

## Document Detail Page

New permanent route `/documents/[id]`, linked from the dashboard grid,
replacing the current post-send-only view:

- Document status, title, page count.
- For DRAFT documents: the existing "Edit fields" / "Send" entry points (no
  recipient/audit sections yet, since there's nothing to show).
- For SENT/IN_PROGRESS/COMPLETED/DECLINED documents:
  - Recipient list: name, email, role, status badge, signing link (copy
    button, as today), a QR code encoding that link (generated client-side
    via the `qrcode` npm package, rendered to a canvas/data URL — no server
    storage needed), and an "Email" button per recipient, shown only when
    `GET /api/config` reports SMTP is configured.
  - Audit trail: chronological event list (across all recipients) with
    timestamp, IP, and user agent, plus the chain-verification indicator
    from `verifyAuditChain()`.

## Delivery: SMTP Email

- `src/lib/email/send.ts` — thin wrapper around `nodemailer`, configured
  from `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` /
  `SMTP_FROM` env vars (following the same env-var convention as
  `DATABASE_URL`). Exports `isEmailConfigured()` (true only if all five vars
  are set) and `sendSigningLinkEmail(recipient, link, documentTitle)`.
- `GET /api/config` — new route returning `{ emailConfigured: boolean }` so
  the client knows whether to render the Email button. Never exposes
  credentials.
- `POST /api/documents/[id]/recipients/[recipientId]/email` — 400s if
  `isEmailConfigured()` is false; otherwise sends the email and records an
  `EMAIL_SENT` audit event. Works for both the first send and a resend —
  there is no separate "resend" endpoint or state.
- Email content: simple text/HTML with the signing link and document title.
  No tracking pixels, no attachments — recipients always view/sign
  in-browser via the link.
- SMTP is off by default (no env vars set in a fresh checkout) per the
  original project brief.

## Error Handling

- `recordAuditEvent()` failures roll back the whole transaction — audit
  logging is not best-effort. A signing action that can't be recorded is
  treated as a failed action, consistent with this app's existing
  all-or-nothing transactional patterns (e.g. `send/route.ts`).
- SMTP send failures return a 502 with the error surfaced in the UI (an
  inline message), but do **not** roll back or affect document/recipient
  state — email delivery is a convenience layered on top of the signing
  state machine, not part of it.
- `appendCertificatePage` failures roll back the completion transaction (see
  above).

## Testing

- Hash-chain integrity: tamper an `AuditEvent` row directly via Prisma,
  confirm `verifyAuditChain()` detects the break at the right index.
- One capture-point test per route in the table above, asserting the right
  event type/detail/recipientId is recorded.
- Certificate-page generation: assert `appendCertificatePage` renders
  without throwing and increases the page count by exactly one.
- `isEmailConfigured()` is false with no SMTP env vars set (default state);
  the email route 400s in that case.
- `sendSigningLinkEmail` test using `nodemailer`'s stream transport (no real
  network), asserting the message contains the signing link.

## Out of Scope

- SMTP settings UI (env vars only, per the "no accounts/settings" project
  constraint).
- Delivery methods beyond copy-link, QR, and email (no SMS, no push).
- External anchoring of the hash chain (e.g. publishing hashes to a
  third-party timestamping service) — the chain is verifiable against the
  local database only, which is sufficient for a single-user localhost app.
- Retroactively backfilling audit events for documents completed before
  Phase 4 ships (existing completed documents simply have no audit trail).
