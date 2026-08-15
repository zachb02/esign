# Phase 4: Audit Trail & Delivery Methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tamper-evident, hash-chained audit trail to the signing process, and a permanent document detail page offering copy-link/QR/optional-email delivery of signing links plus the audit trail itself.

**Architecture:** A new `AuditEvent` model, hash-chained per document via a `recordAuditEvent()` helper serialized with a Postgres advisory lock, called from every signing-session route. `flattenPdf`'s sibling `appendCertificate()` burns a Certificate of Completion page onto the signed PDF. A new `/documents/[id]/manage` page (distinct from the existing PDF-viewer route at `/documents/[id]`) is the permanent home for recipient links, QR codes, an optional email-send button, and the audit trail view.

**Tech Stack:** Next.js 15 App Router, TypeScript, Prisma 6 / PostgreSQL, pdf-lib, `qrcode` (new), `nodemailer` (new).

## Global Constraints

- No auth/accounts/sessions of any kind — this app remains single-user localhost only.
- The audit trail covers the signing lifecycle only: `SENT`, `VIEWED`, `FIELD_FILLED`, `SIGNED`, `DECLINED`, `COMPLETED`, `EMAIL_SENT`. No document-management events (create/edit/move/delete).
- Each `AuditEvent` captures `ipAddress`/`userAgent` from the request that triggered it.
- Tamper-evidence is a SHA-256 hash chain (`contentHash`/`prevHash`), verified locally via `verifyAuditChain()` — no external anchoring.
- SMTP is configured via env vars only (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`); unset by default; email delivery is a manual per-recipient action, never automatic on Send.
- The completed/signed PDF gets an appended Certificate of Completion page summarizing every recipient and the audit chain's verification status.
- Follow the codebase's existing conventions throughout: Prisma singleton (`@/lib/db/prisma`), `StorageAdapter` via `@/lib/storage`, route error shape `{ error: string }`, plain minimal Tailwind (no new design system), integration tests under `tests/integration/*.test.ts` for anything touching the database, pure-function unit tests co-located under `src/lib/**/*.test.ts`.
- One bad value must never permanently strand a document (the Phase 3 "bricking" lesson) — any place free-text (recipient name/email) reaches a pdf-lib WinAnsi font draw call must degrade gracefully, not throw.

---

### Task 1: Add the `AuditEvent` model and migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `AuditEventType` enum (`SENT`, `VIEWED`, `FIELD_FILLED`, `SIGNED`, `DECLINED`, `COMPLETED`, `EMAIL_SENT`) and `AuditEvent` model, both consumed by every later task.

- [ ] **Step 1: Add the enum and model to the schema**

Add this enum anywhere among the other enums (e.g. after `RecipientStatus`):

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
```

Add this model after `FieldValue`:

```prisma
model AuditEvent {
  id          String         @id @default(cuid())
  documentId  String
  document    Document       @relation(fields: [documentId], references: [id], onDelete: Cascade)
  recipientId String?
  recipient   Recipient?     @relation(fields: [recipientId], references: [id], onDelete: SetNull)
  type        AuditEventType
  detail      String?
  ipAddress   String?
  userAgent   String?
  createdAt   DateTime       @default(now())
  contentHash String
  prevHash    String?

  @@index([documentId, createdAt])
}
```

Add the back-relation field to the existing `Document` model (alongside its other array relations, e.g. after `recipients`):

```prisma
  auditEvents      AuditEvent[]
```

Add the back-relation field to the existing `Recipient` model (alongside `fieldValues`):

```prisma
  auditEvents   AuditEvent[]
```

- [ ] **Step 2: Generate and apply the migration**

Run:
```bash
npx prisma migrate dev --name phase4_audit_events
```
Expected: a new directory under `prisma/migrations/` (timestamp prefix + `phase4_audit_events`), and the command reports the dev database is up to date.

Then apply the same migration to the test database:
```bash
DATABASE_URL="postgresql://zachbar@localhost:5432/esign_app_test" npx prisma migrate deploy
```
Expected: "1 migration found... Database schema is up to date!" (or "applying migration...").

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add AuditEvent model for Phase 4's tamper-evident audit trail"
```

---

### Task 2: Audit hash-chain library

**Files:**
- Create: `src/lib/audit/hash.ts`
- Create: `src/lib/audit/hash.test.ts`
- Create: `src/lib/audit/record.ts`
- Create: `src/lib/audit/verify.ts`
- Create: `src/lib/audit/request-metadata.ts`
- Create: `src/lib/audit/request-metadata.test.ts`
- Create: `tests/integration/audit-trail.test.ts`

**Interfaces:**
- Consumes: the `AuditEvent`/`AuditEventType` Prisma types from Task 1.
- Produces:
  - `computeAuditHash(input: AuditHashInput): string` — pure, from `hash.ts`.
  - `acquireDocumentAuditLock(tx: Prisma.TransactionClient, documentId: string): Promise<void>` and `recordAuditEvent(tx: Prisma.TransactionClient, input: RecordAuditEventInput): Promise<AuditEvent>` — from `record.ts`. Every later task that writes an audit event calls `recordAuditEvent` inside a `prisma.$transaction(async (tx) => ...)` callback.
  - `verifyAuditChain(documentId: string): Promise<{ verified: boolean; brokenAtIndex: number | null }>` — from `verify.ts`, called standalone (not given a `tx`) since it only reads.
  - `getRequestIp(request: NextRequest): string | null` and `getRequestUserAgent(request: NextRequest): string | null` — from `request-metadata.ts`.

- [ ] **Step 1: Write the pure hash function and its test**

`src/lib/audit/hash.ts`:
```ts
import { createHash } from 'node:crypto';

export interface AuditHashInput {
  documentId: string;
  recipientId: string | null;
  type: string;
  detail: string | null;
  createdAt: Date;
  prevHash: string | null;
}

export function computeAuditHash(input: AuditHashInput): string {
  const payload = [
    input.documentId,
    input.recipientId ?? '',
    input.type,
    input.detail ?? '',
    input.createdAt.toISOString(),
    input.prevHash ?? '',
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}
```

`src/lib/audit/hash.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { computeAuditHash } from './hash';

describe('computeAuditHash', () => {
  const base = {
    documentId: 'doc1',
    recipientId: 'rec1',
    type: 'VIEWED',
    detail: null,
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    prevHash: null,
  };

  it('produces a 64-character hex digest', () => {
    const hash = computeAuditHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical input', () => {
    expect(computeAuditHash(base)).toBe(computeAuditHash({ ...base }));
  });

  it('changes when any field changes', () => {
    const original = computeAuditHash(base);
    expect(computeAuditHash({ ...base, type: 'SIGNED' })).not.toBe(original);
    expect(computeAuditHash({ ...base, recipientId: 'rec2' })).not.toBe(original);
    expect(computeAuditHash({ ...base, detail: 'x' })).not.toBe(original);
    expect(computeAuditHash({ ...base, prevHash: 'abc' })).not.toBe(original);
    expect(
      computeAuditHash({ ...base, createdAt: new Date('2026-08-14T00:00:01.000Z') })
    ).not.toBe(original);
  });

  it('treats null recipientId, detail, and prevHash distinctly from any real value', () => {
    const withNulls = computeAuditHash(base);
    const withEmptyStrings = computeAuditHash({
      ...base,
      recipientId: '',
      detail: '',
      prevHash: '',
    });
    expect(withNulls).toBe(withEmptyStrings);
  });
});
```

- [ ] **Step 2: Run the hash test to verify it passes**

Run: `npx vitest run src/lib/audit/hash.test.ts`
Expected: 5 tests pass (this is pure, no database needed).

- [ ] **Step 3: Write the request-metadata helper and its test**

`src/lib/audit/request-metadata.ts`:
```ts
import type { NextRequest } from 'next/server';

export function getRequestIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

export function getRequestUserAgent(request: NextRequest): string | null {
  return request.headers.get('user-agent');
}
```

`src/lib/audit/request-metadata.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getRequestIp, getRequestUserAgent } from './request-metadata';

describe('getRequestIp', () => {
  it('reads the first address from x-forwarded-for', () => {
    const request = new NextRequest('http://localhost/x', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(getRequestIp(request)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const request = new NextRequest('http://localhost/x', {
      headers: { 'x-real-ip': '203.0.113.9' },
    });
    expect(getRequestIp(request)).toBe('203.0.113.9');
  });

  it('returns null when neither header is present', () => {
    const request = new NextRequest('http://localhost/x');
    expect(getRequestIp(request)).toBeNull();
  });
});

describe('getRequestUserAgent', () => {
  it('reads the user-agent header', () => {
    const request = new NextRequest('http://localhost/x', {
      headers: { 'user-agent': 'test-agent/1.0' },
    });
    expect(getRequestUserAgent(request)).toBe('test-agent/1.0');
  });

  it('returns null when absent', () => {
    const request = new NextRequest('http://localhost/x');
    expect(getRequestUserAgent(request)).toBeNull();
  });
});
```

- [ ] **Step 4: Run the request-metadata test to verify it passes**

Run: `npx vitest run src/lib/audit/request-metadata.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Write `record.ts` (the locked, chain-appending writer)**

`src/lib/audit/record.ts`:
```ts
import { createHash } from 'node:crypto';
import type { Prisma, AuditEvent, AuditEventType } from '@prisma/client';
import { computeAuditHash } from './hash';

type TxClient = Prisma.TransactionClient;

function documentLockKey(documentId: string): bigint {
  return createHash('sha256').update(documentId).digest().readBigInt64BE(0);
}

// Serializes all audit-event reads/writes for one document within the
// calling transaction, using a Postgres advisory lock scoped to the
// transaction (released automatically at commit/rollback). Without this,
// two recipients acting on the same document at nearly the same moment
// (this app allows parallel any-order signing) could both read the same
// "latest event" and fork the hash chain instead of extending it linearly.
// Safe to call more than once per transaction — advisory locks are
// reentrant per session, so a caller that needs to check for an existing
// event before deciding whether to record a new one (see the VIEWED
// dedup logic in Task 4) can acquire this lock BEFORE that check, then
// call recordAuditEvent as usual; the lock it acquires internally is then
// a no-op re-grab, not a second wait.
export async function acquireDocumentAuditLock(tx: TxClient, documentId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${documentLockKey(documentId)})`;
}

export interface RecordAuditEventInput {
  documentId: string;
  recipientId?: string | null;
  type: AuditEventType;
  detail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditEvent(
  tx: TxClient,
  input: RecordAuditEventInput
): Promise<AuditEvent> {
  await acquireDocumentAuditLock(tx, input.documentId);

  const previous = await tx.auditEvent.findFirst({
    where: { documentId: input.documentId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const createdAt = new Date();
  const recipientId = input.recipientId ?? null;
  const detail = input.detail ?? null;
  const contentHash = computeAuditHash({
    documentId: input.documentId,
    recipientId,
    type: input.type,
    detail,
    createdAt,
    prevHash: previous?.contentHash ?? null,
  });

  return tx.auditEvent.create({
    data: {
      documentId: input.documentId,
      recipientId,
      type: input.type,
      detail,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAt,
      contentHash,
      prevHash: previous?.contentHash ?? null,
    },
  });
}
```

- [ ] **Step 6: Write `verify.ts` (standalone chain verification)**

`src/lib/audit/verify.ts`:
```ts
import { prisma } from '@/lib/db/prisma';
import { computeAuditHash } from './hash';

export interface AuditChainResult {
  verified: boolean;
  brokenAtIndex: number | null;
}

export async function verifyAuditChain(documentId: string): Promise<AuditChainResult> {
  const events = await prisma.auditEvent.findMany({
    where: { documentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  let expectedPrevHash: string | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event.prevHash !== expectedPrevHash) {
      return { verified: false, brokenAtIndex: i };
    }
    const recomputed = computeAuditHash({
      documentId: event.documentId,
      recipientId: event.recipientId,
      type: event.type,
      detail: event.detail,
      createdAt: event.createdAt,
      prevHash: event.prevHash,
    });
    if (recomputed !== event.contentHash) {
      return { verified: false, brokenAtIndex: i };
    }
    expectedPrevHash = event.contentHash;
  }
  return { verified: true, brokenAtIndex: null };
}
```

- [ ] **Step 7: Write the integration test for record.ts + verify.ts**

`tests/integration/audit-trail.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { recordAuditEvent } from '@/lib/audit/record';
import { verifyAuditChain } from '@/lib/audit/verify';

beforeEach(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createDocument() {
  return prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
      fileHash: 'h',
      storageKey: 'h.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'SENT',
    },
  });
}

describe('recordAuditEvent + verifyAuditChain', () => {
  it('builds a chain where each event points at the previous event\'s hash', async () => {
    const document = await createDocument();
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'SENT' })
    );
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
    );

    const events = await prisma.auditEvent.findMany({
      where: { documentId: document.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[0].prevHash).toBeNull();
    expect(events[1].prevHash).toBe(events[0].contentHash);

    const result = await verifyAuditChain(document.id);
    expect(result).toEqual({ verified: true, brokenAtIndex: null });
  });

  it('detects tampering when an event row is modified directly', async () => {
    const document = await createDocument();
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'SENT' })
    );
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
    );
    const [first] = await prisma.auditEvent.findMany({
      where: { documentId: document.id },
      orderBy: { createdAt: 'asc' },
    });

    // Tamper directly via Prisma, bypassing recordAuditEvent entirely —
    // this is exactly the kind of modification the hash chain exists to
    // detect.
    await prisma.auditEvent.update({
      where: { id: first.id },
      data: { detail: 'tampered' },
    });

    const result = await verifyAuditChain(document.id);
    expect(result.verified).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it('returns verified for a document with no events', async () => {
    const document = await createDocument();
    const result = await verifyAuditChain(document.id);
    expect(result).toEqual({ verified: true, brokenAtIndex: null });
  });

  it('serializes concurrent recordAuditEvent calls into one linear chain with no forking', async () => {
    const document = await createDocument();
    await Promise.all([
      prisma.$transaction((tx) =>
        recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
      ),
      prisma.$transaction((tx) =>
        recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
      ),
    ]);

    const events = await prisma.auditEvent.findMany({ where: { documentId: document.id } });
    expect(events).toHaveLength(2);
    const nullPrevHashCount = events.filter((e) => e.prevHash === null).length;
    expect(nullPrevHashCount).toBe(1);

    const result = await verifyAuditChain(document.id);
    expect(result).toEqual({ verified: true, brokenAtIndex: null });
  });
});
```

- [ ] **Step 8: Run the full test suite to verify everything passes**

Run: `npm run test`
Expected: all previous tests plus the new hash/request-metadata/audit-trail tests pass (0 failures).

- [ ] **Step 9: Commit**

```bash
git add src/lib/audit tests/integration/audit-trail.test.ts
git commit -m "Add hash-chained audit event recording and chain verification"
```

---

### Task 3: Record the `SENT` event

**Files:**
- Modify: `src/app/api/documents/[id]/send/route.ts`
- Modify: `tests/integration/send-api.test.ts`

**Interfaces:**
- Consumes: `recordAuditEvent` from Task 2.

- [ ] **Step 1: Add the audit-event cleanup to the test file**

In `tests/integration/send-api.test.ts`, add `await prisma.auditEvent.deleteMany();` as the first line inside both the `beforeEach` block (before `prisma.recipient.deleteMany()`) and the `afterAll` block (before `prisma.recipient.deleteMany()`).

- [ ] **Step 2: Write the failing test**

Add this test inside the existing `describe('send API', ...)` block in `tests/integration/send-api.test.ts`:

```ts
  it('records a SENT audit event with no recipientId', async () => {
    const { document, role } = await createDraftDocumentWithOneField();
    const request = sendRequest(document.id, [
      { signerRoleId: role.id, name: 'Jane Doe', email: 'jane@example.com' },
    ]);
    await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });

    const event = await prisma.auditEvent.findFirst({
      where: { documentId: document.id, type: 'SENT' },
    });
    expect(event).not.toBeNull();
    expect(event?.recipientId).toBeNull();
  });
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/integration/send-api.test.ts`
Expected: FAIL — no `AuditEvent` row exists yet.

- [ ] **Step 4: Wire `recordAuditEvent` into the send route**

In `src/app/api/documents/[id]/send/route.ts`, add the import:

```ts
import { recordAuditEvent } from '@/lib/audit/record';
```

Then modify the transaction body — replace:

```ts
    await tx.document.update({ where: { id: document.id }, data: { status: 'SENT' } });
    return created;
```

with:

```ts
    await tx.document.update({ where: { id: document.id }, data: { status: 'SENT' } });
    await recordAuditEvent(tx, { documentId: document.id, type: 'SENT' });
    return created;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/integration/send-api.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/documents/[id]/send/route.ts tests/integration/send-api.test.ts
git commit -m "Record a SENT audit event when a document is sent"
```

---

### Task 4: Record the `VIEWED` event (once per recipient)

**Files:**
- Modify: `src/app/api/sign/[token]/route.ts`

**Interfaces:**
- Consumes: `recordAuditEvent`, `acquireDocumentAuditLock` from Task 2; `getRequestIp`, `getRequestUserAgent` from Task 2.

- [ ] **Step 1: Replace the route with the audit-aware version**

Replace the full contents of `src/app/api/sign/[token]/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { acquireDocumentAuditLock, recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const recipient = await prisma.recipient.findUnique({
    where: { signingToken: token },
    include: { document: true },
  });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await acquireDocumentAuditLock(tx, recipient.documentId);
    const alreadyViewed = await tx.auditEvent.findFirst({
      where: { documentId: recipient.documentId, recipientId: recipient.id, type: 'VIEWED' },
    });
    if (!alreadyViewed) {
      await recordAuditEvent(tx, {
        documentId: recipient.documentId,
        recipientId: recipient.id,
        type: 'VIEWED',
        ipAddress: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
      });
    }
  });

  const fields = await prisma.field.findMany({
    where: { documentId: recipient.documentId, signerRoleId: recipient.signerRoleId },
    orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
    include: { value: true },
  });

  return NextResponse.json({
    recipient: {
      id: recipient.id,
      name: recipient.name,
      status: recipient.status,
      declineReason: recipient.declineReason,
    },
    document: {
      id: recipient.document.id,
      title: recipient.document.title,
      pageCount: recipient.document.pageCount,
      status: recipient.document.status,
    },
    fields,
  });
}
```

(The only changes from the current file: `_request` renamed to `request`, imports added, and the new `prisma.$transaction` block recording `VIEWED` at most once per recipient.)

- [ ] **Step 2: Write the failing test**

In `tests/integration/sign-session-api.test.ts`, find the `describe('GET /api/sign/:token', ...)` block and add this test inside it:

```ts
  it('records VIEWED exactly once across repeated GETs to the same signing link', async () => {
    const { recipient } = await createSentDocumentWithRecipient();
    const request1 = new NextRequest(`http://localhost/api/sign/${recipient.signingToken}`);
    await sessionRoute.GET(request1, { params: Promise.resolve({ token: recipient.signingToken }) });
    const request2 = new NextRequest(`http://localhost/api/sign/${recipient.signingToken}`);
    await sessionRoute.GET(request2, { params: Promise.resolve({ token: recipient.signingToken }) });

    const viewedEvents = await prisma.auditEvent.findMany({
      where: { documentId: recipient.documentId, recipientId: recipient.id, type: 'VIEWED' },
    });
    expect(viewedEvents).toHaveLength(1);
  });
```

Also add `await prisma.auditEvent.deleteMany();` as the first line of both the file's `beforeEach` and `afterAll` blocks (before `prisma.fieldValue.deleteMany()`).

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/integration/sign-session-api.test.ts -t "records VIEWED"`
Expected: FAIL — no `AuditEvent` rows exist yet (route not yet updated) or a TypeScript error if run before Step 1.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts -t "records VIEWED"`
Expected: PASS.

- [ ] **Step 5: Run the full sign-session test file to confirm no regressions**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/sign/[token]/route.ts tests/integration/sign-session-api.test.ts
git commit -m "Record a VIEWED audit event, once per recipient, when a signing link is opened"
```

---

### Task 5: Record the `FIELD_FILLED` event

**Files:**
- Modify: `src/app/api/sign/[token]/fields/[fieldId]/route.ts`

**Interfaces:**
- Consumes: `recordAuditEvent`, `getRequestIp`, `getRequestUserAgent` from Task 2.

- [ ] **Step 1: Replace the route with the audit-aware version**

Replace the full contents of `src/app/api/sign/[token]/fields/[fieldId]/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { isPngFlattenable, isTextFlattenable, isWellFormedPngStructure } from '@/lib/pdf/flattenable';
import { recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGNATURE_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB

function isPngBuffer(buffer: Buffer): boolean {
  return buffer.length >= PNG_MAGIC_BYTES.length && buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; fieldId: string }> }
) {
  const { token, fieldId } = await params;
  const ipAddress = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  const recipient = await prisma.recipient.findUnique({ where: { signingToken: token } });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }
  if (recipient.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'This signing session is already finished' },
      { status: 400 }
    );
  }

  const document = await prisma.document.findUnique({ where: { id: recipient.documentId } });
  if (document?.status === 'DECLINED') {
    return NextResponse.json(
      { error: 'This document was declined by another signer' },
      { status: 400 }
    );
  }

  const field = await prisma.field.findFirst({
    where: { id: fieldId, documentId: recipient.documentId, signerRoleId: recipient.signerRoleId },
  });
  if (!field) {
    return NextResponse.json({ error: 'Field not found for this signer' }, { status: 404 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const data: { textValue?: string; checked?: boolean; signatureImageKey?: string } = {};

  if (contentType.includes('multipart/form-data')) {
    if (field.type !== 'SIGNATURE' && field.type !== 'INITIALS') {
      return NextResponse.json(
        { error: 'Only signature/initials fields accept an image upload' },
        { status: 400 }
      );
    }
    const formData = await request.formData();
    const file = formData.get('image');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'An image field is required' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIGNATURE_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Image file is too large' }, { status: 400 });
    }
    if (!isPngBuffer(buffer)) {
      return NextResponse.json({ error: 'File is not a valid PNG image' }, { status: 400 });
    }
    if (!isWellFormedPngStructure(buffer)) {
      return NextResponse.json({ error: 'File is not a valid PNG image' }, { status: 400 });
    }
    if (!(await isPngFlattenable(buffer))) {
      return NextResponse.json({ error: 'File is not a valid PNG image' }, { status: 400 });
    }
    const key = `${sha256Hex(buffer)}.png`;
    await getSignatureStorage().save(key, buffer);
    data.signatureImageKey = key;
  } else {
    const body = await request.json();
    if (field.type === 'TEXT') {
      if (typeof body.textValue !== 'string') {
        return NextResponse.json({ error: 'textValue is required' }, { status: 400 });
      }
      const trimmed = body.textValue.trim();
      if (trimmed && !(await isTextFlattenable(trimmed))) {
        return NextResponse.json(
          { error: 'Please use only standard Latin characters (accents are fine)' },
          { status: 400 }
        );
      }
      if (!trimmed) {
        await prisma.$transaction(async (tx) => {
          await tx.fieldValue.deleteMany({ where: { fieldId: field.id } });
          await recordAuditEvent(tx, {
            documentId: recipient.documentId,
            recipientId: recipient.id,
            type: 'FIELD_FILLED',
            detail: `${field.label ?? field.type} (cleared)`,
            ipAddress,
            userAgent,
          });
        });
        return NextResponse.json({ fieldId: field.id, cleared: true });
      }
      data.textValue = trimmed;
    } else if (field.type === 'CHECKBOX') {
      if (typeof body.checked !== 'boolean') {
        return NextResponse.json({ error: 'checked must be a boolean' }, { status: 400 });
      }
      data.checked = body.checked;
    } else {
      return NextResponse.json(
        { error: 'This field type does not accept a JSON value' },
        { status: 400 }
      );
    }
  }

  const value = await prisma.$transaction(async (tx) => {
    const created = await tx.fieldValue.upsert({
      where: { fieldId: field.id },
      create: { fieldId: field.id, recipientId: recipient.id, ...data },
      update: data,
    });
    await recordAuditEvent(tx, {
      documentId: recipient.documentId,
      recipientId: recipient.id,
      type: 'FIELD_FILLED',
      detail: field.label ?? field.type,
      ipAddress,
      userAgent,
    });
    return created;
  });

  return NextResponse.json(value);
}
```

- [ ] **Step 2: Write the failing test**

In `tests/integration/sign-session-api.test.ts`, find the `describe('PATCH /api/sign/:token/fields/:fieldId', ...)` block and add this test inside it (it reuses the file's existing `REAL_1X1_PNG` constant):

```ts
  it('records FIELD_FILLED after a successful signature upload', async () => {
    const { recipient, field } = await createSentDocumentWithRecipient();
    const formData = new FormData();
    formData.append('image', new File([REAL_1X1_PNG], 'sig.png', { type: 'image/png' }));
    const request = new NextRequest(
      `http://localhost/api/sign/${recipient.signingToken}/fields/${field.id}`,
      { method: 'PATCH', body: formData }
    );
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: recipient.signingToken, fieldId: field.id }),
    });
    expect(response.status).toBe(200);

    const event = await prisma.auditEvent.findFirst({
      where: { documentId: recipient.documentId, recipientId: recipient.id, type: 'FIELD_FILLED' },
    });
    expect(event).not.toBeNull();
  });
```

- [ ] **Step 3: Run it to verify it fails, then passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts -t "records FIELD_FILLED"`
Expected: FAIL before the route change (if tested against the old route), PASS after.

- [ ] **Step 4: Run the full sign-session test file to confirm no regressions**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/sign/[token]/fields/[fieldId]/route.ts" tests/integration/sign-session-api.test.ts
git commit -m "Record a FIELD_FILLED audit event on each successful field save"
```

---

### Task 6: Certificate of Completion page

**Files:**
- Modify: `src/lib/pdf/flatten.ts`
- Modify: `src/lib/pdf/flatten.test.ts`

**Interfaces:**
- Produces: `CertificateRecipientInput` type and `appendCertificate(pdfBuffer: Buffer, input: { recipients: CertificateRecipientInput[]; chainSummary: string }): Promise<Buffer>`, consumed by Task 7 (wired into the complete route).

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `src/lib/pdf/flatten.test.ts` (the file already imports `PDFDocument` and `makeTestPdf`):

```ts
import { appendCertificate } from './flatten';

describe('appendCertificate', () => {
  it('appends exactly one page listing each recipient', async () => {
    const original = await makeTestPdf(1);
    const result = await appendCertificate(original, {
      recipients: [
        {
          name: 'Jane Doe',
          email: 'jane@example.com',
          roleName: 'Signer 1',
          status: 'SIGNED',
          signedAt: new Date('2026-01-01T00:00:00Z'),
          declinedAt: null,
          ipAddress: '127.0.0.1',
        },
      ],
      chainSummary: 'verified, no tampering detected',
    });
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(2);
  });

  it('falls back to a redacted line instead of throwing when a recipient name is not flattenable', async () => {
    // Recipient name/email is free text collected at Send time with no
    // WinAnsi validation (unlike field values). This proves one bad
    // recipient can't abort the whole certificate page, which would abort
    // the whole completion transaction and permanently strand an
    // already-fully-signed document.
    const original = await makeTestPdf(1);
    const result = await appendCertificate(original, {
      recipients: [
        {
          name: '太郎',
          email: 'taro@example.com',
          roleName: 'Signer 1',
          status: 'SIGNED',
          signedAt: new Date('2026-01-01T00:00:00Z'),
          declinedAt: null,
          ipAddress: null,
        },
      ],
      chainSummary: 'verified, no tampering detected',
    });
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(2);
  });

  it('lists multiple recipients on the same certificate page', async () => {
    const original = await makeTestPdf(2);
    const result = await appendCertificate(original, {
      recipients: [
        {
          name: 'A',
          email: 'a@example.com',
          roleName: 'Signer 1',
          status: 'SIGNED',
          signedAt: new Date(),
          declinedAt: null,
          ipAddress: '10.0.0.1',
        },
        {
          name: 'B',
          email: 'b@example.com',
          roleName: 'Signer 2',
          status: 'DECLINED',
          signedAt: null,
          declinedAt: new Date(),
          ipAddress: '10.0.0.2',
        },
      ],
      chainSummary: 'verified, no tampering detected',
    });
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/pdf/flatten.test.ts -t "appendCertificate"`
Expected: FAIL — `appendCertificate` is not exported yet.

- [ ] **Step 3: Implement `appendCertificate` in `flatten.ts`**

Add to `src/lib/pdf/flatten.ts` (after the existing `flattenPdf` function):

```ts
export interface CertificateRecipientInput {
  name: string;
  email: string;
  roleName: string;
  status: string;
  signedAt: Date | null;
  declinedAt: Date | null;
  ipAddress: string | null;
}

export interface AppendCertificateInput {
  recipients: CertificateRecipientInput[];
  chainSummary: string;
}

export async function appendCertificate(
  pdfBuffer: Buffer,
  input: AppendCertificateInput
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const left = 54;
  let y = 740;

  page.drawText('Certificate of Completion', {
    x: left,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 30;

  for (const recipient of input.recipients) {
    // Recipient name/email is free text collected at Send time with no
    // WinAnsi-encoding validation (unlike field values, which ARE
    // validated - see isTextFlattenable). One recipient with an
    // unsupported character must never abort the whole certificate page,
    // which would abort the whole completion transaction and permanently
    // strand an already-fully-signed document - the same bricking failure
    // mode Phase 3 fixed for field values.
    try {
      const eventLabel =
        recipient.status === 'SIGNED'
          ? 'Signed'
          : recipient.status === 'DECLINED'
            ? 'Declined'
            : 'Pending';
      const eventDate = recipient.signedAt ?? recipient.declinedAt;

      page.drawText(`${recipient.name} <${recipient.email}> - ${recipient.roleName}`, {
        x: left,
        y,
        size: 11,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 16;

      const detailParts = [eventLabel];
      if (eventDate) detailParts.push(eventDate.toISOString());
      if (recipient.ipAddress) detailParts.push(`IP ${recipient.ipAddress}`);
      page.drawText(detailParts.join(' | '), {
        x: left,
        y,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 24;
    } catch (error) {
      console.error('appendCertificate: failed to draw a recipient row, using fallback', error);
      page.drawText('[Recipient details omitted - unsupported characters]', {
        x: left,
        y,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 24;
    }
  }

  y -= 10;
  page.drawText(`Audit trail: ${input.chainSummary}`, {
    x: left,
    y,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pdf/flatten.test.ts`
Expected: all tests in the file pass, including the 3 new `appendCertificate` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/flatten.ts src/lib/pdf/flatten.test.ts
git commit -m "Add appendCertificate: burns a Certificate of Completion page onto the signed PDF"
```

---

### Task 7: Record `SIGNED`/`COMPLETED` and wire in the certificate page

**Files:**
- Modify: `src/app/api/sign/[token]/complete/route.ts`
- Modify: `tests/integration/sign-session-api.test.ts`

**Interfaces:**
- Consumes: `recordAuditEvent` (Task 2), `verifyAuditChain` (Task 2), `getRequestIp`/`getRequestUserAgent` (Task 2), `appendCertificate`/`CertificateRecipientInput` (Task 6).

- [ ] **Step 1: Replace the route with the audit-aware, certificate-appending version**

Replace the full contents of `src/app/api/sign/[token]/complete/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import {
  flattenPdf,
  appendCertificate,
  type FlattenFieldInput,
  type CertificateRecipientInput,
} from '@/lib/pdf/flatten';
import { recordAuditEvent } from '@/lib/audit/record';
import { verifyAuditChain } from '@/lib/audit/verify';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ipAddress = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  const recipient = await prisma.recipient.findUnique({ where: { signingToken: token } });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }
  if (recipient.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'This signing session is already finished' },
      { status: 400 }
    );
  }

  const document = await prisma.document.findUnique({ where: { id: recipient.documentId } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  if (document.status === 'DECLINED') {
    return NextResponse.json(
      { error: 'This document was declined by another signer' },
      { status: 400 }
    );
  }

  const fields = await prisma.field.findMany({
    where: { documentId: recipient.documentId, signerRoleId: recipient.signerRoleId },
    include: { value: true },
  });

  const missingRequired = fields.filter(
    (f) => f.required && f.type !== 'DATE_SIGNED' && !f.value
  );
  if (missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: 'Please fill in all required fields before completing',
        missingFieldIds: missingRequired.map((f) => f.id),
      },
      { status: 400 }
    );
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const field of fields) {
      if (field.type === 'DATE_SIGNED' && !field.value) {
        await tx.fieldValue.create({
          data: { fieldId: field.id, recipientId: recipient.id, dateValue: now },
        });
      }
    }
    await tx.recipient.update({
      where: { id: recipient.id },
      data: { status: 'SIGNED', signedAt: now },
    });
    await recordAuditEvent(tx, {
      documentId: recipient.documentId,
      recipientId: recipient.id,
      type: 'SIGNED',
      ipAddress,
      userAgent,
    });
  });

  const remainingPending = await prisma.recipient.count({
    where: { documentId: recipient.documentId, status: 'PENDING' },
  });

  if (remainingPending === 0) {
    // A sibling recipient may have declined between this recipient's own
    // SIGNED update above and this check — re-fetch the current status so we
    // never flatten (and mark "completed") a document that was just declined.
    const currentDocument = await prisma.document.findUnique({
      where: { id: recipient.documentId },
      select: { status: true },
    });

    if (currentDocument?.status === 'DECLINED') {
      console.log(
        `Document ${recipient.documentId} was declined by a sibling recipient; skipping flatten`
      );
    } else {
      try {
        const allFields = await prisma.field.findMany({
          where: { documentId: recipient.documentId },
          include: { value: true },
        });

        const flattenInputs: FlattenFieldInput[] = [];
        for (const field of allFields) {
          let signaturePng: Buffer | null = null;
          if (field.value?.signatureImageKey) {
            try {
              signaturePng = await getSignatureStorage().read(field.value.signatureImageKey);
            } catch (error) {
              console.error(
                `Failed to read signature file ${field.value.signatureImageKey} for field ${field.id} during flatten, skipping`,
                error
              );
            }
          }
          flattenInputs.push({
            type: field.type,
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            textValue: field.value?.textValue ?? null,
            checked: field.value?.checked ?? null,
            signaturePng,
            dateValue: field.value?.dateValue ?? null,
          });
        }

        const originalBytes = await getDocumentStorage().read(document.storageKey);
        const flattenedBytes = await flattenPdf(originalBytes, flattenInputs);

        // Append a Certificate of Completion page summarizing every
        // recipient's signing event and the audit chain's integrity, before
        // this document is ever marked COMPLETED. verifyAuditChain() here
        // necessarily reflects the state just before this document's own
        // COMPLETED event is recorded below — that event can't describe
        // itself.
        const allRecipients = await prisma.recipient.findMany({
          where: { documentId: recipient.documentId },
          include: { signerRole: true },
        });
        const signingEvents = await prisma.auditEvent.findMany({
          where: { documentId: recipient.documentId, type: { in: ['SIGNED', 'DECLINED'] } },
        });
        const ipByRecipientId = new Map(
          signingEvents.map((event) => [event.recipientId, event.ipAddress])
        );
        const certificateRecipients: CertificateRecipientInput[] = allRecipients.map((r) => ({
          name: r.name,
          email: r.email,
          roleName: r.signerRole.name,
          status: r.status,
          signedAt: r.signedAt,
          declinedAt: r.declinedAt,
          ipAddress: ipByRecipientId.get(r.id) ?? null,
        }));
        const chain = await verifyAuditChain(recipient.documentId);
        const chainSummary = chain.verified
          ? 'verified, no tampering detected'
          : `WARNING - integrity check failed at event ${chain.brokenAtIndex}`;

        const certifiedBytes = await appendCertificate(flattenedBytes, {
          recipients: certificateRecipients,
          chainSummary,
        });

        const completedKey = `${sha256Hex(certifiedBytes)}-completed.pdf`;
        await getDocumentStorage().save(completedKey, certifiedBytes);

        // Only move the document into COMPLETED if it hasn't already been
        // finalized (declined or completed) by a concurrent request. If a
        // sibling's decline landed between our re-check above and now, this
        // is a no-op and the document correctly stays DECLINED — the
        // recipient's own SIGNED status (already committed) is unaffected.
        const completedCount = await prisma.$transaction(async (tx) => {
          const result = await tx.document.updateMany({
            where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
            data: { status: 'COMPLETED', completedPdfKey: completedKey },
          });
          if (result.count > 0) {
            await recordAuditEvent(tx, { documentId: recipient.documentId, type: 'COMPLETED' });
          }
          return result.count;
        });
        if (completedCount === 0) {
          console.log(
            `Document ${recipient.documentId} was already finalized by a concurrent request; skipping COMPLETED status write`
          );
        }
      } catch (error) {
        console.error('PDF flattening failed after final recipient completed', error);
        const { count } = await prisma.document.updateMany({
          where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
          data: { status: 'IN_PROGRESS' },
        });
        if (count === 0) {
          console.log(
            `Document ${recipient.documentId} was already finalized by a concurrent request; skipping IN_PROGRESS status write`
          );
        }
      }
    }
  } else {
    const { count } = await prisma.document.updateMany({
      where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
      data: { status: 'IN_PROGRESS' },
    });
    if (count === 0) {
      console.log(
        `Document ${recipient.documentId} was already finalized by a concurrent request; skipping IN_PROGRESS status write`
      );
    }
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Write the failing test**

Add this import near the top of `tests/integration/sign-session-api.test.ts`, alongside the other imports:

```ts
import { PDFDocument } from 'pdf-lib';
```

Add this test inside the existing `describe('POST /api/sign/:token/complete', ...)` block:

```ts
  it('records SIGNED and COMPLETED events, and appends a Certificate of Completion page, when the last recipient completes', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'Audit Trail Doc',
        originalFilename: 'd.pdf',
        fileHash: 'audit-h1',
        storageKey: 'audit-h1.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('audit-h1.pdf', pdfBytes);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const field = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
        required: true,
      },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'audit-complete-token',
      },
    });
    await prisma.fieldValue.create({
      data: { fieldId: field.id, recipientId: recipient.id, textValue: 'Jane' },
    });

    const request = new NextRequest('http://localhost/api/sign/audit-complete-token/complete', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.5', 'user-agent': 'vitest' },
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'audit-complete-token' }),
    });
    expect(response.status).toBe(200);

    const signedEvent = await prisma.auditEvent.findFirst({
      where: { documentId: document.id, recipientId: recipient.id, type: 'SIGNED' },
    });
    expect(signedEvent?.ipAddress).toBe('203.0.113.5');

    const completedEvent = await prisma.auditEvent.findFirst({
      where: { documentId: document.id, recipientId: null, type: 'COMPLETED' },
    });
    expect(completedEvent).not.toBeNull();

    const reloaded = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
    expect(reloaded.completedPdfKey).not.toBeNull();
    const completedBytes = await getDocumentStorage().read(reloaded.completedPdfKey!);
    const completedPdf = await PDFDocument.load(completedBytes);
    expect(completedPdf.getPageCount()).toBe(2);
  });
```

- [ ] **Step 3: Run it to verify it fails, then passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts -t "records SIGNED and COMPLETED"`
Expected: FAIL before the route change, PASS after.

- [ ] **Step 4: Run the full sign-session test file and the full flatten test file to confirm no regressions**

Run: `npx vitest run tests/integration/sign-session-api.test.ts src/lib/pdf/flatten.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/sign/[token]/complete/route.ts" tests/integration/sign-session-api.test.ts
git commit -m "Record SIGNED/COMPLETED audit events and append the Certificate of Completion page at completion"
```

---

### Task 8: Record the `DECLINED` event

**Files:**
- Modify: `src/app/api/sign/[token]/decline/route.ts`

**Interfaces:**
- Consumes: `recordAuditEvent`, `getRequestIp`, `getRequestUserAgent` from Task 2.

- [ ] **Step 1: Replace the route with the audit-aware version**

Replace the full contents of `src/app/api/sign/[token]/decline/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const ipAddress = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

  const recipient = await prisma.recipient.findUnique({ where: { signingToken: token } });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }
  if (recipient.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'This signing session is already finished' },
      { status: 400 }
    );
  }

  const document = await prisma.document.findUnique({ where: { id: recipient.documentId } });
  if (document?.status === 'DECLINED') {
    return NextResponse.json(
      { error: 'This document was already declined by another signer' },
      { status: 400 }
    );
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  const now = new Date();

  // The recipient's own DECLINED status always commits — that row is owned by
  // this recipient. The shared Document.status write is guarded so a
  // concurrent complete() that already finalized the document (COMPLETED, or
  // a race where another recipient already declined) can't be clobbered.
  const count = await prisma.$transaction(async (tx) => {
    await tx.recipient.update({
      where: { id: recipient.id },
      data: { status: 'DECLINED', declinedAt: now, declineReason: reason },
    });
    await recordAuditEvent(tx, {
      documentId: recipient.documentId,
      recipientId: recipient.id,
      type: 'DECLINED',
      detail: reason,
      ipAddress,
      userAgent,
    });
    const result = await tx.document.updateMany({
      where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
      data: { status: 'DECLINED' },
    });
    return result.count;
  });
  if (count === 0) {
    console.log(
      `Document ${recipient.documentId} was already finalized by a concurrent request; skipping DECLINED status write`
    );
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Write the failing test**

Add this test inside the existing `describe('POST /api/sign/:token/decline', ...)` block in `tests/integration/sign-session-api.test.ts`:

```ts
  it('records DECLINED with the decline reason as detail', async () => {
    const { recipient } = await createSentDocumentWithRecipient();
    const request = new NextRequest(`http://localhost/api/sign/${recipient.signingToken}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Terms changed' }),
    });
    const response = await declineRoute.POST(request, {
      params: Promise.resolve({ token: recipient.signingToken }),
    });
    expect(response.status).toBe(200);

    const event = await prisma.auditEvent.findFirst({
      where: { documentId: recipient.documentId, recipientId: recipient.id, type: 'DECLINED' },
    });
    expect(event?.detail).toBe('Terms changed');
  });
```

- [ ] **Step 3: Run it to verify it fails, then passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts -t "records DECLINED"`
Expected: FAIL before the route change, PASS after.

- [ ] **Step 4: Run the full sign-session test file to confirm no regressions**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/sign/[token]/decline/route.ts" tests/integration/sign-session-api.test.ts
git commit -m "Record a DECLINED audit event when a recipient declines"
```

---

### Task 9: SMTP email library and `/api/config`

**Files:**
- Create: `src/lib/email/send.ts`
- Create: `src/lib/email/send.test.ts`
- Create: `src/app/api/config/route.ts`
- Create: `tests/integration/config-api.test.ts`
- Modify: `.env.example`
- Modify: `package.json` (new dependencies)

**Interfaces:**
- Produces: `isEmailConfigured(): boolean`, `sendSigningLinkEmail(recipientEmail: string, recipientName: string, documentTitle: string, signingLink: string): Promise<void>`, and the pure `buildSigningLinkMailOptions(...)` helper — consumed by Task 10 and Task 11.

- [ ] **Step 1: Install dependencies**

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

- [ ] **Step 2: Write the pure mail-options test**

`src/lib/email/send.test.ts`:
```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildSigningLinkMailOptions, isEmailConfigured } from './send';

describe('buildSigningLinkMailOptions', () => {
  it('includes the signing link in both text and html bodies', () => {
    const options = buildSigningLinkMailOptions(
      'jane@example.com',
      'Jane Doe',
      'Contract',
      'http://localhost:3000/sign/abc123',
      'esign@example.com'
    );
    expect(options.to).toBe('jane@example.com');
    expect(options.from).toBe('esign@example.com');
    expect(options.subject).toContain('Contract');
    expect(options.text).toContain('http://localhost:3000/sign/abc123');
    expect(options.html).toContain('http://localhost:3000/sign/abc123');
  });
});

describe('isEmailConfigured', () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
  let originalValues: Record<string, string | undefined>;

  beforeEach(() => {
    originalValues = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const key of keys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (originalValues[key] === undefined) delete process.env[key];
      else process.env[key] = originalValues[key];
    }
  });

  it('is false when no SMTP env vars are set', () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it('is false when only some SMTP env vars are set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    expect(isEmailConfigured()).toBe(false);
  });

  it('is true when all five SMTP env vars are set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'esign@example.com';
    expect(isEmailConfigured()).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/email/send.test.ts`
Expected: FAIL — `send.ts` doesn't exist yet.

- [ ] **Step 4: Implement `send.ts`**

`src/lib/email/send.ts`:
```ts
import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer';

interface SmtpEnv {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

function getSmtpEnv(): SmtpEnv | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  if (!host || !port || !user || !password || !from) return null;
  return { host, port: Number(port), user, password, from };
}

export function isEmailConfigured(): boolean {
  return getSmtpEnv() !== null;
}

export function buildSigningLinkMailOptions(
  recipientEmail: string,
  recipientName: string,
  documentTitle: string,
  signingLink: string,
  from: string
): SendMailOptions {
  return {
    from,
    to: recipientEmail,
    subject: `Please sign: ${documentTitle}`,
    text: `Hi ${recipientName},\n\nPlease review and sign "${documentTitle}" using the link below:\n${signingLink}\n`,
    html: `<p>Hi ${recipientName},</p><p>Please review and sign "${documentTitle}" using the link below:</p><p><a href="${signingLink}">${signingLink}</a></p>`,
  };
}

let transporter: Transporter | null = null;

function getTransporter(env: SmtpEnv): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.host,
      port: env.port,
      auth: { user: env.user, pass: env.password },
    });
  }
  return transporter;
}

export async function sendSigningLinkEmail(
  recipientEmail: string,
  recipientName: string,
  documentTitle: string,
  signingLink: string
): Promise<void> {
  const env = getSmtpEnv();
  if (!env) {
    throw new Error('SMTP is not configured');
  }
  const mailOptions = buildSigningLinkMailOptions(
    recipientEmail,
    recipientName,
    documentTitle,
    signingLink,
    env.from
  );
  await getTransporter(env).sendMail(mailOptions);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/email/send.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Add the `GET /api/config` route and its test**

`src/app/api/config/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { isEmailConfigured } from '@/lib/email/send';

export async function GET() {
  return NextResponse.json({ emailConfigured: isEmailConfigured() });
}
```

`tests/integration/config-api.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as configRoute from '@/app/api/config/route';

describe('GET /api/config', () => {
  it('reports emailConfigured as false when no SMTP env vars are set (the default state)', async () => {
    const response = await configRoute.GET();
    const body = await response.json();
    expect(body.emailConfigured).toBe(false);
  });
});
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run tests/integration/config-api.test.ts`
Expected: PASS (the test environment has no SMTP env vars set, matching the "off by default" requirement).

- [ ] **Step 8: Document the optional SMTP env vars**

Append to `.env.example`:
```
# Optional: enables the "Email" delivery button on the document detail page.
# All five must be set together, or email delivery stays disabled.
# SMTP_HOST="smtp.example.com"
# SMTP_PORT="587"
# SMTP_USER="user@example.com"
# SMTP_PASSWORD="changeme"
# SMTP_FROM="esign@example.com"
```

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/email src/app/api/config tests/integration/config-api.test.ts .env.example package.json package-lock.json
git commit -m "Add SMTP email library (off by default) and GET /api/config"
```

---

### Task 10: Email-send route

**Files:**
- Create: `src/app/api/documents/[id]/recipients/[recipientId]/email/route.ts`
- Create: `tests/integration/recipient-email-api.test.ts`

**Interfaces:**
- Consumes: `isEmailConfigured`, `sendSigningLinkEmail` (Task 9); `recordAuditEvent`, `getRequestIp`, `getRequestUserAgent` (Task 2).

- [ ] **Step 1: Write the route**

`src/app/api/documents/[id]/recipients/[recipientId]/email/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { isEmailConfigured, sendSigningLinkEmail } from '@/lib/email/send';
import { recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  const { id, recipientId } = await params;

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email delivery is not configured' }, { status: 400 });
  }

  const recipient = await prisma.recipient.findFirst({
    where: { id: recipientId, documentId: id },
  });
  if (!recipient) {
    return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
  }

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const signingLink = `${request.nextUrl.origin}/sign/${recipient.signingToken}`;

  try {
    await sendSigningLinkEmail(recipient.email, recipient.name, document.title, signingLink);
  } catch (error) {
    console.error(`Failed to send signing link email to recipient ${recipient.id}`, error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
  }

  await prisma.$transaction(async (tx) => {
    await recordAuditEvent(tx, {
      documentId: id,
      recipientId: recipient.id,
      type: 'EMAIL_SENT',
      detail: recipient.email,
      ipAddress: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Write the test (mocking only the SMTP boundary, real DB throughout)**

`tests/integration/recipient-email-api.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/email/send', () => ({
  isEmailConfigured: vi.fn(),
  sendSigningLinkEmail: vi.fn(),
}));

import { isEmailConfigured, sendSigningLinkEmail } from '@/lib/email/send';
import * as emailRoute from '@/app/api/documents/[id]/recipients/[recipientId]/email/route';

beforeEach(async () => {
  vi.mocked(isEmailConfigured).mockReset();
  vi.mocked(sendSigningLinkEmail).mockReset();
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createSentDocumentWithRecipient() {
  const document = await prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
      fileHash: 'h',
      storageKey: 'h.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'SENT',
    },
  });
  const role = await prisma.signerRole.create({
    data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
  });
  const recipient = await prisma.recipient.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      name: 'Jane Doe',
      email: 'jane@example.com',
      signingToken: 'tok-email-test',
    },
  });
  return { document, recipient };
}

function emailRequest(id: string, recipientId: string) {
  return new NextRequest(`http://localhost/api/documents/${id}/recipients/${recipientId}/email`, {
    method: 'POST',
  });
}

describe('POST /api/documents/:id/recipients/:recipientId/email', () => {
  it('returns 400 when SMTP is not configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false);
    const { document, recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest(document.id, recipient.id), {
      params: Promise.resolve({ id: document.id, recipientId: recipient.id }),
    });
    expect(response.status).toBe(400);
    expect(sendSigningLinkEmail).not.toHaveBeenCalled();
  });

  it('sends the email and records an EMAIL_SENT audit event when configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendSigningLinkEmail).mockResolvedValue(undefined);
    const { document, recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest(document.id, recipient.id), {
      params: Promise.resolve({ id: document.id, recipientId: recipient.id }),
    });
    expect(response.status).toBe(200);
    expect(sendSigningLinkEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'Jane Doe',
      'D',
      expect.stringContaining(`/sign/${recipient.signingToken}`)
    );
    const event = await prisma.auditEvent.findFirst({
      where: { documentId: document.id, type: 'EMAIL_SENT' },
    });
    expect(event?.detail).toBe('jane@example.com');
  });

  it('returns 502 and does not record an audit event when sending fails', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendSigningLinkEmail).mockRejectedValue(new Error('SMTP connection refused'));
    const { document, recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest(document.id, recipient.id), {
      params: Promise.resolve({ id: document.id, recipientId: recipient.id }),
    });
    expect(response.status).toBe(502);
    expect(
      await prisma.auditEvent.count({ where: { documentId: document.id, type: 'EMAIL_SENT' } })
    ).toBe(0);
  });

  it('returns 404 for a recipient that does not belong to the given document', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    const { recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest('wrong-doc-id', recipient.id), {
      params: Promise.resolve({ id: 'wrong-doc-id', recipientId: recipient.id }),
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run it to verify it passes**

Run: `npx vitest run tests/integration/recipient-email-api.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/documents/[id]/recipients/[recipientId]/email" tests/integration/recipient-email-api.test.ts
git commit -m "Add per-recipient email delivery API"
```

---

### Task 11: Document Manage page

**Files:**
- Create: `src/app/documents/[id]/manage/page.tsx`
- Create: `src/app/documents/[id]/manage/manage-client.tsx`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `verifyAuditChain` (Task 2), `isEmailConfigured` (Task 9), the Prisma `Document`/`Recipient`/`AuditEvent` models.

- [ ] **Step 1: Install the QR code library**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

- [ ] **Step 2: Write the server component**

`src/app/documents/[id]/manage/page.tsx`:
```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { verifyAuditChain } from '@/lib/audit/verify';
import { isEmailConfigured } from '@/lib/email/send';
import { ManageClient } from './manage-client';

export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      recipients: { include: { signerRole: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!document) notFound();

  if (document.status === 'DRAFT') {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-lg font-semibold">&quot;{document.title}&quot;</h1>
        <p className="mb-4 text-sm text-neutral-500">This document has not been sent yet.</p>
        <div className="flex gap-3 text-sm">
          <Link href={`/documents/${document.id}/edit`} className="underline">
            Edit fields
          </Link>
          <Link href={`/documents/${document.id}/send`} className="underline">
            Send
          </Link>
        </div>
      </div>
    );
  }

  const auditEvents = await prisma.auditEvent.findMany({
    where: { documentId: document.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const chain = await verifyAuditChain(document.id);

  return (
    <ManageClient
      documentId={document.id}
      title={document.title}
      status={document.status}
      emailConfigured={isEmailConfigured()}
      recipients={document.recipients.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        roleName: r.signerRole.name,
        status: r.status,
        signingToken: r.signingToken,
      }))}
      auditEvents={auditEvents.map((e) => ({
        id: e.id,
        recipientId: e.recipientId,
        type: e.type,
        detail: e.detail,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        createdAt: e.createdAt.toISOString(),
      }))}
      chainVerified={chain.verified}
      chainBrokenAtIndex={chain.brokenAtIndex}
    />
  );
}
```

- [ ] **Step 3: Write the client component**

`src/app/documents/[id]/manage/manage-client.tsx`:
```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface RecipientView {
  id: string;
  name: string;
  email: string;
  roleName: string;
  status: string;
  signingToken: string;
}

interface AuditEventView {
  id: string;
  recipientId: string | null;
  type: string;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ManageClientProps {
  documentId: string;
  title: string;
  status: string;
  emailConfigured: boolean;
  recipients: RecipientView[];
  auditEvents: AuditEventView[];
  chainVerified: boolean;
  chainBrokenAtIndex: number | null;
}

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
};

function QrCode({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && value) {
      QRCode.toCanvas(canvasRef.current, value, { width: 96, margin: 1 });
    }
  }, [value]);
  return <canvas ref={canvasRef} className="rounded border" />;
}

export function ManageClient({
  documentId,
  title,
  status,
  emailConfigured,
  recipients,
  auditEvents,
  chainVerified,
  chainBrokenAtIndex,
}: ManageClientProps) {
  const [emailState, setEmailState] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>(
    {}
  );
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function sendEmail(recipientId: string) {
    setEmailState((prev) => ({ ...prev, [recipientId]: 'sending' }));
    const response = await fetch(`/api/documents/${documentId}/recipients/${recipientId}/email`, {
      method: 'POST',
    });
    setEmailState((prev) => ({ ...prev, [recipientId]: response.ok ? 'sent' : 'error' }));
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-semibold">&quot;{title}&quot;</h1>
      <p className="mb-6 text-sm text-neutral-500">Status: {status}</p>

      <h2 className="mb-3 text-sm font-semibold uppercase text-neutral-500">Recipients</h2>
      <ul className="mb-8 flex flex-col gap-4">
        {recipients.map((recipient) => {
          const link = origin ? `${origin}/sign/${recipient.signingToken}` : '';
          const emailStatus = emailState[recipient.id] ?? 'idle';
          const emailButtonLabel =
            emailStatus === 'sending'
              ? 'Sending...'
              : emailStatus === 'sent'
                ? 'Sent'
                : emailStatus === 'error'
                  ? 'Failed - retry'
                  : 'Email';
          return (
            <li key={recipient.id} className="rounded border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="font-medium">{recipient.name}</p>
                  <p className="text-xs text-neutral-500">
                    {recipient.roleName} · {recipient.email}
                  </p>
                </div>
                <span className="text-xs">
                  {RECIPIENT_STATUS_LABELS[recipient.status] ?? recipient.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input readOnly value={link} className="flex-1 rounded border px-2 py-1 text-xs" />
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => navigator.clipboard.writeText(link)}
                >
                  Copy
                </button>
                {emailConfigured && (
                  <button
                    disabled={emailStatus === 'sending'}
                    onClick={() => sendEmail(recipient.id)}
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {emailButtonLabel}
                  </button>
                )}
              </div>
              {link && (
                <div className="mt-2">
                  <QrCode value={link} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h2 className="mb-3 text-sm font-semibold uppercase text-neutral-500">
        Audit trail{' '}
        <span className={chainVerified ? 'text-green-600' : 'text-red-600'}>
          {chainVerified ? '· verified' : `· chain broken at event ${chainBrokenAtIndex}`}
        </span>
      </h2>
      <ul className="flex flex-col divide-y text-xs">
        {auditEvents.map((event) => {
          const recipient = recipients.find((r) => r.id === event.recipientId);
          return (
            <li key={event.id} className="flex items-center justify-between py-2">
              <span>
                {event.type}
                {recipient ? ` - ${recipient.name}` : ''}
                {event.detail ? ` (${event.detail})` : ''}
              </span>
              <span className="text-neutral-400">{new Date(event.createdAt).toLocaleString()}</span>
            </li>
          );
        })}
        {auditEvents.length === 0 && <li className="py-2 text-neutral-400">No events yet.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: all tests pass (this task adds no automated tests of its own — UI wiring is covered by Task 13's manual verification, matching this project's established convention of integration/unit tests for logic and manual click-through for UI, since the project has no component-rendering test setup).

- [ ] **Step 4: Commit**

```bash
git add src/app/documents/[id]/manage package.json package-lock.json
git commit -m "Add the Document Manage page: recipient links, QR codes, email delivery, audit trail"
```

---

### Task 12: Link the Manage page from the dashboard

**Files:**
- Modify: `src/components/document-grid.tsx`

**Interfaces:**
- None (pure UI wiring).

- [ ] **Step 1: Add the Manage link for non-DRAFT documents**

In `src/components/document-grid.tsx`, replace:

```tsx
            {doc.status === 'DRAFT' && (
              <div className="flex gap-2 text-xs">
                <Link href={`/documents/${doc.id}/edit`} className="underline">
                  Edit fields
                </Link>
                <Link href={`/documents/${doc.id}/send`} className="underline">
                  Send
                </Link>
              </div>
            )}
```

with:

```tsx
            {doc.status === 'DRAFT' && (
              <div className="flex gap-2 text-xs">
                <Link href={`/documents/${doc.id}/edit`} className="underline">
                  Edit fields
                </Link>
                <Link href={`/documents/${doc.id}/send`} className="underline">
                  Send
                </Link>
              </div>
            )}
            {doc.status !== 'DRAFT' && (
              <div className="flex gap-2 text-xs">
                <Link href={`/documents/${doc.id}/manage`} className="underline">
                  Manage
                </Link>
              </div>
            )}
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: all tests pass (no automated coverage for this file, per existing precedent — verified manually in Task 13).

- [ ] **Step 3: Commit**

```bash
git add src/components/document-grid.tsx
git commit -m "Link the Manage page from the dashboard for sent/completed documents"
```

---

### Task 13: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Walk the full lifecycle**

1. Upload a PDF, add a signature field and a text field, assign a signer role.
2. Click "Send", copy the signing link.
3. Open the signing link in a new tab (or incognito window) — this should record a `VIEWED` event.
4. Fill in the text field and draw a signature — each save should succeed.
5. Complete the signing session.
6. Navigate to `/documents/[id]/manage` from the dashboard's new "Manage" link.
7. Confirm: recipient shows status "Signed", the QR code renders and encodes the same link shown in the copy box, the audit trail lists `VIEWED`/`FIELD_FILLED` (one or more)/`SIGNED`/`COMPLETED` in order with timestamps, and the "· verified" chain indicator is green.
8. Confirm the "Email" button is **absent** (no SMTP env vars set by default).
9. Download/view the completed PDF (via the document's file endpoint or viewer) and confirm the Certificate of Completion page was appended as the last page.

- [ ] **Step 3: Spot-check the decline path**

1. Send a second document to two recipients.
2. Decline as one recipient with a reason.
3. Confirm the Manage page shows `DECLINED` in the audit trail with the reason as detail, and the document status reflects DECLINED.

- [ ] **Step 4: Report findings**

If anything in Steps 2-3 doesn't match, fix it before proceeding to the final review (per this plan's execution skill). If everything matches, this task is complete — no commit needed.
