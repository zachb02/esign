# Phase 3: Recipients, Signing Session & Signed-PDF Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign real recipients to a document's signer roles, let each recipient open a public signing session and fill in their fields (draw a signature, type text, check boxes), and flatten everything into a final signed PDF once all recipients finish.

**Architecture:** Extends the Next.js 15 + Prisma/Postgres + local-filesystem-storage stack from Phases 1-2. A `Recipient` (per signer role, per document) carries an unguessable `signingToken` that is the sole credential for `/sign/:token` — no auth system. A `FieldValue` (one per `Field`, `@unique`) holds whatever a recipient filled in. `Document.status` (already defined, unused since Phase 1) now actually drives `DRAFT → SENT → IN_PROGRESS → COMPLETED`/`DECLINED`. A pure `flattenPdf()` module (pdf-lib) draws every field's value onto the original PDF once the last recipient completes.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Prisma 6 + PostgreSQL, `pdfjs-dist`, `pdf-lib`, `@napi-rs/canvas`, Vitest.

## Global Constraints

- No auth, login, signup, accounts, sessions, orgs, teams, roles (user-facing), permissions, multi-tenancy, billing, or API keys. The signing token is the only "credential" and it is a capability token, not a login.
- No placeholder implementations, no `TODO`s, no mocked features.
- No email sending, no QR codes, no sequential/ordered signing, no audit trail/IP tracking, no cryptographic document verification, no typed (font-rendered) signatures, no expiring links — all deferred to later phases.
- Recipients sign in parallel (any order) — never enforce an order between signer roles.
- Once a document leaves `DRAFT`, its fields and signer-roles can no longer be created/updated/deleted (400) — Templates are never affected by this (they have no `status`).
- A signing token that doesn't match any `Recipient` returns 404 on every `/sign/:token*` route.
- Completing or declining an already-`SIGNED`/`DECLINED` recipient, or any recipient on a `DECLINED` document, is rejected (400).
- All new/modified routes follow the existing `{ error: string }` response-shape convention.
- All file I/O continues through `StorageAdapter` (`@/lib/storage`) — never direct `fs` calls.
- Git remote: `https://github.com/zachb02/esign.git`. Commit at the end of every task. Do not add a `Co-Authored-By` trailer to commit messages.

---

### Task 1: Prisma schema — RecipientStatus, Recipient, FieldValue

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_phase3_recipients/migration.sql` (generated)

**Interfaces:**
- Produces: `RecipientStatus` enum (`PENDING | SIGNED | DECLINED`), `Recipient`, `FieldValue` Prisma models; `Document.recipients`/`Document.completedPdfKey`, `SignerRole.recipients`, `Field.value` — consumed by every later task.

- [ ] **Step 1: Add `completedPdfKey` and `recipients` to the `Document` model**

In `prisma/schema.prisma`, find the `Document` model:

```prisma
model Document {
  id               String         @id @default(cuid())
  title            String
  folderId         String?
  folder           Folder?        @relation(fields: [folderId], references: [id], onDelete: SetNull)
  originalFilename String
  fileHash         String
  storageKey       String
  thumbnailKey     String?
  pageCount        Int
  fileSizeBytes    Int
  status           DocumentStatus @default(DRAFT)
  signerRoles      SignerRole[]
  fields           Field[]
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}
```

Replace it with (adds `completedPdfKey` after `thumbnailKey` and `recipients` after `fields`):

```prisma
model Document {
  id               String         @id @default(cuid())
  title            String
  folderId         String?
  folder           Folder?        @relation(fields: [folderId], references: [id], onDelete: SetNull)
  originalFilename String
  fileHash         String
  storageKey       String
  thumbnailKey     String?
  completedPdfKey  String?
  pageCount        Int
  fileSizeBytes    Int
  status           DocumentStatus @default(DRAFT)
  signerRoles      SignerRole[]
  fields           Field[]
  recipients       Recipient[]
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}
```

- [ ] **Step 2: Add `recipients` to `SignerRole` and `value` to `Field`**

Find the `SignerRole` model:

```prisma
model SignerRole {
  id         String    @id @default(cuid())
  templateId String?
  template   Template? @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documentId String?
  document   Document? @relation(fields: [documentId], references: [id], onDelete: Cascade)
  name       String
  order      Int
  colorIndex Int
  fields     Field[]
  createdAt  DateTime  @default(now())
}
```

Replace with (adds `recipients Recipient[]` after `fields`):

```prisma
model SignerRole {
  id         String      @id @default(cuid())
  templateId String?
  template   Template?   @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documentId String?
  document   Document?   @relation(fields: [documentId], references: [id], onDelete: Cascade)
  name       String
  order      Int
  colorIndex Int
  fields     Field[]
  recipients Recipient[]
  createdAt  DateTime    @default(now())
}
```

Find the `Field` model:

```prisma
model Field {
  id           String     @id @default(cuid())
  templateId   String?
  template     Template?  @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documentId   String?
  document     Document?  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  signerRoleId String
  signerRole   SignerRole @relation(fields: [signerRoleId], references: [id], onDelete: Cascade)
  type         FieldType
  page         Int
  x            Float
  y            Float
  width        Float
  height       Float
  required     Boolean    @default(true)
  label        String?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
}
```

Replace with (adds `value FieldValue?` after `label`):

```prisma
model Field {
  id           String      @id @default(cuid())
  templateId   String?
  template     Template?   @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documentId   String?
  document     Document?   @relation(fields: [documentId], references: [id], onDelete: Cascade)
  signerRoleId String
  signerRole   SignerRole  @relation(fields: [signerRoleId], references: [id], onDelete: Cascade)
  type         FieldType
  page         Int
  x            Float
  y            Float
  width        Float
  height       Float
  required     Boolean     @default(true)
  label        String?
  value        FieldValue?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
}
```

- [ ] **Step 3: Append the `RecipientStatus` enum, `Recipient`, and `FieldValue` models**

At the end of `prisma/schema.prisma`, append:

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

- [ ] **Step 4: Generate and apply the migration**

Run: `npx prisma migrate dev --name phase3_recipients`
Expected: creates a new migration adding `RecipientStatus`, `Recipient`, `FieldValue`, and the new `Document.completedPdfKey` column, applies it to `esign_app`, regenerates the Prisma client.

- [ ] **Step 5: Apply the same migration to the test database**

Run: `DATABASE_URL="postgresql://zachbar@localhost:5432/esign_app_test" npx prisma migrate deploy`

- [ ] **Step 6: Verify**

Run: `npx prisma migrate status` (default `.env`) and again with `DATABASE_URL` pointed at `esign_app_test` — both must report "up to date".
Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Recipient and FieldValue models for Phase 3"
```

---

### Task 2: Signature storage adapter

**Files:**
- Modify: `src/lib/paths.ts`
- Modify: `src/lib/storage/index.ts`
- Test: `src/lib/paths.test.ts`

**Interfaces:**
- Produces: `getSignaturesDir(): string`, `getSignatureStorage(): StorageAdapter` — consumed by Task 9 (field-value upload) and Task 10 (PDF flattening).

- [ ] **Step 1: Add a failing test case for `getSignaturesDir`**

`src/lib/paths.test.ts` already exists from Phase 1. Add this test inside the existing `describe('paths', ...)` block, alongside the existing tests for `getDocumentsDir`/`getThumbnailsDir`:

```ts
  it('nests signatures under the app data dir', () => {
    process.env.ESIGN_DATA_DIR = '/tmp/esign-test-override';
    expect(getSignaturesDir()).toBe('/tmp/esign-test-override/signatures');
  });
```

Add `getSignaturesDir` to the existing `import { getAppDataDir, getDocumentsDir, getThumbnailsDir } from './paths';` line at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/paths.test.ts`
Expected: FAIL — `getSignaturesDir` is not exported.

- [ ] **Step 3: Add `getSignaturesDir` to `src/lib/paths.ts`**

After the existing `getThumbnailsDir` function, add:

```ts
export function getSignaturesDir(): string {
  return path.join(getAppDataDir(), 'signatures');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/paths.test.ts`
Expected: PASS (4 tests now).

- [ ] **Step 5: Add `getSignatureStorage` to `src/lib/storage/index.ts`**

Replace the file's contents with:

```ts
import { LocalFsStorageAdapter } from './local-fs-storage-adapter';
import { getDocumentsDir, getThumbnailsDir, getSignaturesDir } from '@/lib/paths';
import type { StorageAdapter } from './storage-adapter';

let documentStorage: StorageAdapter | null = null;
let thumbnailStorage: StorageAdapter | null = null;
let signatureStorage: StorageAdapter | null = null;

export function getDocumentStorage(): StorageAdapter {
  if (!documentStorage) {
    documentStorage = new LocalFsStorageAdapter(getDocumentsDir());
  }
  return documentStorage;
}

export function getThumbnailStorage(): StorageAdapter {
  if (!thumbnailStorage) {
    thumbnailStorage = new LocalFsStorageAdapter(getThumbnailsDir());
  }
  return thumbnailStorage;
}

export function getSignatureStorage(): StorageAdapter {
  if (!signatureStorage) {
    signatureStorage = new LocalFsStorageAdapter(getSignaturesDir());
  }
  return signatureStorage;
}

export type { StorageAdapter } from './storage-adapter';
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/paths.ts src/lib/paths.test.ts src/lib/storage/index.ts
git commit -m "Add signature storage adapter"
```

---

### Task 3: Signing token generator

**Files:**
- Create: `src/lib/recipients/token.ts`
- Test: `src/lib/recipients/token.test.ts`

**Interfaces:**
- Produces: `generateSigningToken(): string` — consumed by Task 7 (send API).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/recipients/token.test.ts
import { describe, expect, it } from 'vitest';
import { generateSigningToken } from './token';

describe('generateSigningToken', () => {
  it('generates a URL-safe token of reasonable length', () => {
    const token = generateSigningToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a different token on every call', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateSigningToken()));
    expect(tokens.size).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/recipients/token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/recipients/token.ts
import { randomBytes } from 'node:crypto';

export function generateSigningToken(): string {
  return randomBytes(32).toString('base64url');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/recipients/token.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipients/token.ts src/lib/recipients/token.test.ts
git commit -m "Add signing token generator"
```

---

### Task 4: Document-lock helper

**Files:**
- Create: `src/lib/documents/lock.ts`
- Test: `src/lib/documents/lock.test.ts`

**Interfaces:**
- Produces: `isDocumentEditable(status: string): boolean` — consumed by Task 6 (lock enforcement).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/documents/lock.test.ts
import { describe, expect, it } from 'vitest';
import { isDocumentEditable } from './lock';

describe('isDocumentEditable', () => {
  it('is true for DRAFT', () => {
    expect(isDocumentEditable('DRAFT')).toBe(true);
  });

  it('is false for every non-DRAFT status', () => {
    for (const status of ['SENT', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'EXPIRED', 'ARCHIVED']) {
      expect(isDocumentEditable(status)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/documents/lock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/documents/lock.ts
export function isDocumentEditable(status: string): boolean {
  return status === 'DRAFT';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/documents/lock.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/lock.ts src/lib/documents/lock.test.ts
git commit -m "Add document-editable lock helper"
```

---

### Task 5: PDF flattening module

**Files:**
- Create: `src/lib/pdf/flatten.ts`
- Test: `src/lib/pdf/flatten.test.ts`

**Interfaces:**
- Consumes: `makeTestPdf` (`tests/fixtures/make-test-pdf`, Phase 1).
- Produces: `FlattenFieldInput` type, `flattenPdf(pdfBuffer: Buffer, fields: FlattenFieldInput[]): Promise<Buffer>` — consumed by Task 10 (complete API).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pdf/flatten.test.ts
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { flattenPdf } from './flatten';
import { makeTestPdf } from '../../../tests/fixtures/make-test-pdf';

function makeTestSignaturePng(): Buffer {
  const canvas = createCanvas(100, 40);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(10, 10, 80, 20);
  return canvas.toBuffer('image/png');
}

describe('flattenPdf', () => {
  it('preserves page count and produces a valid PDF with no fields', async () => {
    const original = await makeTestPdf(3);
    const flattened = await flattenPdf(original, []);
    expect(flattened.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(flattened);
    expect(doc.getPageCount()).toBe(3);
  });

  it('grows the PDF when a signature image is embedded', async () => {
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.25,
        height: 0.06,
        textValue: null,
        checked: null,
        signaturePng: makeTestSignaturePng(),
        dateValue: null,
      },
    ]);
    expect(flattened.length).toBeGreaterThan(original.length);
  });

  it('grows the PDF when a TEXT field has a value', async () => {
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
        textValue: 'Jane Doe',
        checked: null,
        signaturePng: null,
        dateValue: null,
      },
    ]);
    expect(flattened.length).toBeGreaterThan(original.length);
  });

  it('draws a checkmark only when CHECKBOX is checked', async () => {
    const original = await makeTestPdf(1);
    const baseField = {
      type: 'CHECKBOX' as const,
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.03,
      height: 0.03,
      textValue: null,
      signaturePng: null,
      dateValue: null,
    };
    const checked = await flattenPdf(original, [{ ...baseField, checked: true }]);
    const unchecked = await flattenPdf(original, [{ ...baseField, checked: false }]);
    expect(checked.length).toBeGreaterThan(unchecked.length);
  });

  it('draws the date string for a DATE_SIGNED field', async () => {
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'DATE_SIGNED',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.15,
        height: 0.04,
        textValue: null,
        checked: null,
        signaturePng: null,
        dateValue: new Date('2026-08-13T00:00:00Z'),
      },
    ]);
    expect(flattened.length).toBeGreaterThan(original.length);
  });

  it('skips a field pointing at a page beyond the document', async () => {
    const original = await makeTestPdf(1);
    await expect(
      flattenPdf(original, [
        {
          type: 'TEXT',
          page: 5,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.04,
          textValue: 'Should be skipped',
          checked: null,
          signaturePng: null,
          dateValue: null,
        },
      ])
    ).resolves.toBeInstanceOf(Buffer);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pdf/flatten.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pdf/flatten.ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { FieldType } from '@prisma/client';

export interface FlattenFieldInput {
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  textValue: string | null;
  checked: boolean | null;
  signaturePng: Buffer | null;
  dateValue: Date | null;
}

export async function flattenPdf(
  pdfBuffer: Buffer,
  fields: FlattenFieldInput[]
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const boxX = field.x * pageWidth;
    const boxWidth = field.width * pageWidth;
    const boxHeight = field.height * pageHeight;
    // field.y is a fraction from the TOP of the page (matches the browser/CSS
    // convention used by the field editor's overlay). pdf-lib's origin is the
    // bottom-left corner, so the box's bottom edge is pageHeight minus the
    // top offset minus the box height.
    const boxTopY = pageHeight - field.y * pageHeight;
    const boxBottomY = boxTopY - boxHeight;

    if ((field.type === 'SIGNATURE' || field.type === 'INITIALS') && field.signaturePng) {
      const pngImage = await pdfDoc.embedPng(field.signaturePng);
      page.drawImage(pngImage, { x: boxX, y: boxBottomY, width: boxWidth, height: boxHeight });
    } else if (field.type === 'TEXT' && field.textValue) {
      const fontSize = Math.min(boxHeight * 0.7, 12);
      page.drawText(field.textValue, {
        x: boxX + 2,
        y: boxBottomY + (boxHeight - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    } else if (field.type === 'CHECKBOX' && field.checked) {
      const fontSize = boxHeight * 0.8;
      page.drawText('X', {
        x: boxX + boxWidth * 0.15,
        y: boxBottomY + boxHeight * 0.15,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    } else if (field.type === 'DATE_SIGNED' && field.dateValue) {
      const dateString = field.dateValue.toISOString().slice(0, 10);
      const fontSize = Math.min(boxHeight * 0.7, 12);
      page.drawText(dateString, {
        x: boxX + 2,
        y: boxBottomY + (boxHeight - fontSize) / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pdf/flatten.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/flatten.ts src/lib/pdf/flatten.test.ts
git commit -m "Add PDF flattening module for signed-document generation"
```

---

### Task 6: Lock enforcement on fields/signer-roles routes

**Files:**
- Modify: `src/app/api/fields/route.ts`
- Modify: `src/app/api/fields/[id]/route.ts`
- Modify: `src/app/api/signer-roles/route.ts`
- Modify: `src/app/api/signer-roles/[id]/route.ts`
- Modify: `src/app/documents/[id]/edit/page.tsx`
- Test: `tests/integration/document-lock.test.ts`

**Interfaces:**
- Consumes: `isDocumentEditable` (`@/lib/documents/lock`, Task 4).
- Produces: all four routes now reject (400) any mutation targeting a Field/SignerRole owned by a non-`DRAFT` Document. Templates are never affected.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/document-lock.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as fieldsRoute from '@/app/api/fields/route';
import * as fieldRoute from '@/app/api/fields/[id]/route';
import * as signerRolesRoute from '@/app/api/signer-roles/route';
import * as signerRoleRoute from '@/app/api/signer-roles/[id]/route';

beforeEach(async () => {
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.template.deleteMany();
});

afterAll(async () => {
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.template.deleteMany();
  await prisma.$disconnect();
});

async function createSentDocumentWithFieldAndRole() {
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
    },
  });
  return { document, role, field };
}

describe('document lock enforcement', () => {
  it('rejects creating a field on a non-DRAFT document', async () => {
    const { document } = await createSentDocumentWithFieldAndRole();
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'document',
        ownerId: document.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
      }),
    });
    const response = await fieldsRoute.POST(request);
    expect(response.status).toBe(400);
  });

  it('rejects updating a field on a non-DRAFT document', async () => {
    const { field } = await createSentDocumentWithFieldAndRole();
    const request = new NextRequest(`http://localhost/api/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0.5 }),
    });
    const response = await fieldRoute.PATCH(request, { params: Promise.resolve({ id: field.id }) });
    expect(response.status).toBe(400);
  });

  it('rejects deleting a field on a non-DRAFT document', async () => {
    const { field } = await createSentDocumentWithFieldAndRole();
    const request = new NextRequest(`http://localhost/api/fields/${field.id}`, { method: 'DELETE' });
    const response = await fieldRoute.DELETE(request, { params: Promise.resolve({ id: field.id }) });
    expect(response.status).toBe(400);
  });

  it('rejects creating a signer role on a non-DRAFT document', async () => {
    const { document } = await createSentDocumentWithFieldAndRole();
    const request = new NextRequest('http://localhost/api/signer-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'document', ownerId: document.id }),
    });
    const response = await signerRolesRoute.POST(request);
    expect(response.status).toBe(400);
  });

  it('rejects deleting a signer role on a non-DRAFT document', async () => {
    const { document, role } = await createSentDocumentWithFieldAndRole();
    await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 2', order: 1, colorIndex: 1 },
    });
    const request = new NextRequest(`http://localhost/api/signer-roles/${role.id}`, {
      method: 'DELETE',
    });
    const response = await signerRoleRoute.DELETE(request, { params: Promise.resolve({ id: role.id }) });
    expect(response.status).toBe(400);
  });

  it('still allows field mutations on a DRAFT document', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'Draft doc',
        originalFilename: 'd.pdf',
        fileHash: 'h2',
        storageKey: 'h2.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'DRAFT',
      },
    });
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'document',
        ownerId: document.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
      }),
    });
    const response = await fieldsRoute.POST(request);
    expect(response.status).toBe(201);
  });

  it('never restricts Template field mutations', async () => {
    const template = await prisma.template.create({
      data: {
        title: 'T',
        originalFilename: 't.pdf',
        fileHash: 'h3',
        storageKey: 'h3.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
      },
    });
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'template',
        ownerId: template.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
      }),
    });
    const response = await fieldsRoute.POST(request);
    expect(response.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/document-lock.test.ts`
Expected: FAIL — all six assertions on rejected mutations currently succeed instead (they aren't locked yet); the DRAFT/Template ones already pass.

- [ ] **Step 3: Modify `src/app/api/fields/route.ts`'s `POST` handler**

Add the import at the top of the file, alongside the existing imports:

```ts
import { isDocumentEditable } from '@/lib/documents/lock';
```

Find this block:

```ts
  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }

  const ownerWhere = ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId };
```

Replace with:

```ts
  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }
  if (ownerType === 'document' && !isDocumentEditable((owner as { status: string }).status)) {
    return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
  }

  const ownerWhere = ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId };
```

- [ ] **Step 4: Modify `src/app/api/fields/[id]/route.ts`'s `PATCH` and `DELETE` handlers**

Add the import at the top:

```ts
import { isDocumentEditable } from '@/lib/documents/lock';
```

In `PATCH`, find:

```ts
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  const data: {
```

Replace with:

```ts
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  if (existing.documentId) {
    const document = await prisma.document.findUnique({ where: { id: existing.documentId } });
    if (document && !isDocumentEditable(document.status)) {
      return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
    }
  }

  const data: {
```

In `DELETE`, find:

```ts
  const { id } = await params;
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  await prisma.field.delete({ where: { id } });
```

Replace with:

```ts
  const { id } = await params;
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  if (existing.documentId) {
    const document = await prisma.document.findUnique({ where: { id: existing.documentId } });
    if (document && !isDocumentEditable(document.status)) {
      return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
    }
  }
  await prisma.field.delete({ where: { id } });
```

- [ ] **Step 5: Modify `src/app/api/signer-roles/route.ts`'s `POST` handler**

Add the import at the top:

```ts
import { isDocumentEditable } from '@/lib/documents/lock';
```

Find:

```ts
  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }

  const ownerWhere = ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId };
```

Replace with:

```ts
  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }
  if (ownerType === 'document' && !isDocumentEditable((owner as { status: string }).status)) {
    return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
  }

  const ownerWhere = ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId };
```

- [ ] **Step 6: Modify `src/app/api/signer-roles/[id]/route.ts`'s `DELETE` handler**

Add the import at the top:

```ts
import { isDocumentEditable } from '@/lib/documents/lock';
```

Find:

```ts
  const { id } = await params;
  const existing = await prisma.signerRole.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Signer role not found' }, { status: 404 });
  }

  const siblingWhere = existing.templateId
```

Replace with:

```ts
  const { id } = await params;
  const existing = await prisma.signerRole.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Signer role not found' }, { status: 404 });
  }
  if (existing.documentId) {
    const document = await prisma.document.findUnique({ where: { id: existing.documentId } });
    if (document && !isDocumentEditable(document.status)) {
      return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
    }
  }

  const siblingWhere = existing.templateId
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/integration/document-lock.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Lock the field editor page itself for non-DRAFT documents**

The API-layer checks above stop any mutation from persisting, but the editor page
would still render its full drag/drop UI for a locked document, only to have every
action silently fail. Replace `src/app/documents/[id]/edit/page.tsx`'s contents with:

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { FieldEditor } from '@/components/field-editor/field-editor';
import { isDocumentEditable } from '@/lib/documents/lock';

export default async function DocumentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) notFound();

  if (!isDocumentEditable(document.status)) {
    return (
      <div className="p-6">
        <p>
          &quot;{document.title}&quot; can no longer be edited (status:{' '}
          {document.status.replace('_', ' ').toLowerCase()}).
        </p>
      </div>
    );
  }

  return (
    <FieldEditor
      ownerType="document"
      ownerId={document.id}
      title={document.title}
      fileUrl={`/api/documents/${document.id}/file`}
    />
  );
}
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 10: Run the full test suite**

Run: `npm run test`
Expected: all tests, including every existing Phase 1/2 test, still pass.

- [ ] **Step 11: Commit**

```bash
git add src/app/api/fields src/app/api/signer-roles src/app/documents/[id]/edit/page.tsx tests/integration/document-lock.test.ts
git commit -m "Reject field/signer-role mutations once a document leaves DRAFT"
```

---

### Task 7: Send API

**Files:**
- Create: `src/app/api/documents/[id]/send/route.ts`
- Test: `tests/integration/send-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `generateSigningToken` (`@/lib/recipients/token`, Task 3).
- Produces: `POST /api/documents/:id/send` — consumed by Task 14 (Send UI).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/send-api.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as sendRoute from '@/app/api/documents/[id]/send/route';

beforeEach(async () => {
  await prisma.recipient.deleteMany();
  await prisma.fieldValue.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.recipient.deleteMany();
  await prisma.fieldValue.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createDraftDocumentWithOneField() {
  const document = await prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
      fileHash: 'h',
      storageKey: 'h.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'DRAFT',
    },
  });
  const role = await prisma.signerRole.create({
    data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
  });
  await prisma.field.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.06,
    },
  });
  return { document, role };
}

function sendRequest(documentId: string, assignments: unknown) {
  return new NextRequest(`http://localhost/api/documents/${documentId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments }),
  });
}

describe('send API', () => {
  it('creates a recipient per signer role and sets status to SENT', async () => {
    const { document, role } = await createDraftDocumentWithOneField();
    const request = sendRequest(document.id, [
      { signerRoleId: role.id, name: 'Jane Doe', email: 'jane@example.com' },
    ]);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.recipients).toHaveLength(1);
    expect(body.recipients[0].signingToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const reloaded = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloaded?.status).toBe('SENT');
  });

  it('rejects sending with a missing assignment for a signer role', async () => {
    const { document } = await createDraftDocumentWithOneField();
    const request = sendRequest(document.id, []);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(400);
    expect(await prisma.recipient.count()).toBe(0);
  });

  it('rejects sending a document with zero fields', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'Empty',
        originalFilename: 'e.pdf',
        fileHash: 'h2',
        storageKey: 'h2.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'DRAFT',
      },
    });
    const request = sendRequest(document.id, []);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(400);
  });

  it('rejects sending a document that is not DRAFT', async () => {
    const { document, role } = await createDraftDocumentWithOneField();
    await prisma.document.update({ where: { id: document.id }, data: { status: 'SENT' } });
    const request = sendRequest(document.id, [
      { signerRoleId: role.id, name: 'Jane Doe', email: 'jane@example.com' },
    ]);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/send-api.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write `src/app/api/documents/[id]/send/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { generateSigningToken } from '@/lib/recipients/token';

interface Assignment {
  signerRoleId: string;
  name: string;
  email: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const document = await prisma.document.findUnique({
    where: { id },
    include: { signerRoles: true, fields: true },
  });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  if (document.status !== 'DRAFT') {
    return NextResponse.json({ error: 'This document has already been sent' }, { status: 400 });
  }
  if (document.fields.length === 0) {
    return NextResponse.json(
      { error: 'Add at least one field before sending this document' },
      { status: 400 }
    );
  }

  const assignments: Assignment[] = Array.isArray(body.assignments) ? body.assignments : [];
  const assignmentByRoleId = new Map(assignments.map((a) => [a.signerRoleId, a]));

  for (const role of document.signerRoles) {
    const assignment = assignmentByRoleId.get(role.id);
    if (
      !assignment ||
      typeof assignment.name !== 'string' ||
      !assignment.name.trim() ||
      typeof assignment.email !== 'string' ||
      !assignment.email.trim()
    ) {
      return NextResponse.json(
        { error: `Missing name/email assignment for signer role "${role.name}"` },
        { status: 400 }
      );
    }
  }

  const recipients = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const role of document.signerRoles) {
      const assignment = assignmentByRoleId.get(role.id)!;
      const recipient = await tx.recipient.create({
        data: {
          documentId: document.id,
          signerRoleId: role.id,
          name: assignment.name.trim(),
          email: assignment.email.trim(),
          signingToken: generateSigningToken(),
        },
      });
      created.push(recipient);
    }
    await tx.document.update({ where: { id: document.id }, data: { status: 'SENT' } });
    return created;
  });

  return NextResponse.json({ recipients }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/send-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documents/[id]/send tests/integration/send-api.test.ts
git commit -m "Add send API: assign recipients to signer roles, generate signing tokens"
```

---

### Task 8: Signing session GET API

**Files:**
- Create: `src/app/api/sign/[token]/route.ts`
- Test: `tests/integration/sign-session-api.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `GET /api/sign/:token` — consumed by Task 16 (signing session UI). This task's test file will be extended by Tasks 9-11.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/sign-session-api.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as sessionRoute from '@/app/api/sign/[token]/route';

beforeEach(async () => {
  await prisma.fieldValue.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.fieldValue.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createSentDocumentWithRecipient() {
  const document = await prisma.document.create({
    data: {
      title: 'Contract',
      originalFilename: 'c.pdf',
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
  const field = await prisma.field.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.06,
    },
  });
  const recipient = await prisma.recipient.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      name: 'Jane Doe',
      email: 'jane@example.com',
      signingToken: 'test-token-123',
    },
  });
  return { document, role, field, recipient };
}

describe('GET /api/sign/:token', () => {
  it('returns the recipient, document, and their fields for a valid token', async () => {
    const { field } = await createSentDocumentWithRecipient();
    const request = new NextRequest('http://localhost/api/sign/test-token-123');
    const response = await sessionRoute.GET(request, {
      params: Promise.resolve({ token: 'test-token-123' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recipient.name).toBe('Jane Doe');
    expect(body.recipient.status).toBe('PENDING');
    expect(body.document.title).toBe('Contract');
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0].id).toBe(field.id);
    expect(body.fields[0].value).toBeNull();
  });

  it('returns 404 for an unknown token', async () => {
    const request = new NextRequest('http://localhost/api/sign/does-not-exist');
    const response = await sessionRoute.GET(request, {
      params: Promise.resolve({ token: 'does-not-exist' }),
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write `src/app/api/sign/[token]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _request: NextRequest,
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sign/[token]/route.ts tests/integration/sign-session-api.test.ts
git commit -m "Add signing session GET API"
```

---

### Task 9: Signing session field-value API

**Files:**
- Create: `src/app/api/sign/[token]/fields/[fieldId]/route.ts`
- Test: append to `tests/integration/sign-session-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getSignatureStorage` (`@/lib/storage`, Task 2), `sha256Hex` (`@/lib/pdf/hash`, Phase 1).
- Produces: `PATCH /api/sign/:token/fields/:fieldId` — consumed by Task 16 (signing session UI).

- [ ] **Step 1: Append the failing test cases**

Add these `describe` blocks to the end of `tests/integration/sign-session-api.test.ts` (after the existing `describe('GET /api/sign/:token', ...)` block), and add `import * as fieldValueRoute from '@/app/api/sign/[token]/fields/[fieldId]/route';` to the top of the file alongside the existing import:

```ts
describe('PATCH /api/sign/:token/fields/:fieldId', () => {
  it('saves a TEXT value via JSON', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h4',
        storageKey: 'h4.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
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
      },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'text-token',
      },
    });

    const request = new NextRequest(`http://localhost/api/sign/text-token/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'Jane Doe' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'text-token', fieldId: field.id }),
    });
    expect(response.status).toBe(200);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value?.textValue).toBe('Jane Doe');
    expect(value?.recipientId).toBe(recipient.id);
  });

  it('saves a signature image via multipart upload', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h5',
        storageKey: 'h5.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const field = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.25,
        height: 0.06,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'sig-token',
      },
    });

    const formData = new FormData();
    formData.append('image', new File([Buffer.from([1, 2, 3, 4])], 'sig.png', { type: 'image/png' }));
    const request = new NextRequest(`http://localhost/api/sign/sig-token/fields/${field.id}`, {
      method: 'PATCH',
      body: formData,
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'sig-token', fieldId: field.id }),
    });
    expect(response.status).toBe(200);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value?.signatureImageKey).toMatch(/\.png$/);
  });

  it('rejects a field-value update for an unknown token', async () => {
    const request = new NextRequest('http://localhost/api/sign/nope/fields/whatever', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'x' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'nope', fieldId: 'whatever' }),
    });
    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: FAIL — route module not found (the new test cases; the GET tests from Task 8 still pass).

- [ ] **Step 3: Write `src/app/api/sign/[token]/fields/[fieldId]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; fieldId: string }> }
) {
  const { token, fieldId } = await params;

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
    const key = `${sha256Hex(buffer)}.png`;
    await getSignatureStorage().save(key, buffer);
    data.signatureImageKey = key;
  } else {
    const body = await request.json();
    if (field.type === 'TEXT') {
      if (typeof body.textValue !== 'string' || !body.textValue.trim()) {
        return NextResponse.json({ error: 'textValue is required' }, { status: 400 });
      }
      data.textValue = body.textValue.trim();
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

  const value = await prisma.fieldValue.upsert({
    where: { fieldId: field.id },
    create: { fieldId: field.id, recipientId: recipient.id, ...data },
    update: data,
  });

  return NextResponse.json(value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/sign/[token]/fields" tests/integration/sign-session-api.test.ts
git commit -m "Add signing session field-value API: text/checkbox JSON, signature image upload"
```

---

### Task 10: Complete API

**Files:**
- Create: `src/app/api/sign/[token]/complete/route.ts`
- Test: append to `tests/integration/sign-session-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getDocumentStorage`/`getSignatureStorage` (`@/lib/storage`), `sha256Hex` (`@/lib/pdf/hash`), `flattenPdf` (`@/lib/pdf/flatten`, Task 5), `makeTestPdf` (`tests/fixtures/make-test-pdf`).
- Produces: `POST /api/sign/:token/complete` — consumed by Task 16 (signing session UI).

- [ ] **Step 1: Append the failing test cases**

Add `import * as completeRoute from '@/app/api/sign/[token]/complete/route';` and `import { getDocumentStorage } from '@/lib/storage';` and `import { makeTestPdf } from '../fixtures/make-test-pdf';` to the top of `tests/integration/sign-session-api.test.ts`, then append:

```ts
describe('POST /api/sign/:token/complete', () => {
  it('rejects completion when a required field is missing a value', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h6',
        storageKey: 'h6.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h6.pdf', pdfBytes);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    await prisma.field.create({
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
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'incomplete-token',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/incomplete-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'incomplete-token' }),
    });
    expect(response.status).toBe(400);
  });

  it('completes a single-recipient document, flattens the PDF, and marks it COMPLETED', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h7',
        storageKey: 'h7.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h7.pdf', pdfBytes);
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
        signingToken: 'complete-token',
      },
    });
    await prisma.fieldValue.create({
      data: { fieldId: field.id, recipientId: recipient.id, textValue: 'Jane Doe' },
    });

    const request = new NextRequest('http://localhost/api/sign/complete-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'complete-token' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipient = await prisma.recipient.findUnique({ where: { id: recipient.id } });
    expect(reloadedRecipient?.status).toBe('SIGNED');
    expect(reloadedRecipient?.signedAt).not.toBeNull();

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('COMPLETED');
    expect(reloadedDocument?.completedPdfKey).not.toBeNull();

    const flattenedBytes = await getDocumentStorage().read(reloadedDocument!.completedPdfKey!);
    expect(flattenedBytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sets status to IN_PROGRESS when one of two recipients completes', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h8',
        storageKey: 'h8.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h8.pdf', pdfBytes);
    const roleA = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const roleB = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 2', order: 1, colorIndex: 1 },
    });
    await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        type: 'CHECKBOX',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.03,
        height: 0.03,
        required: false,
      },
    });
    await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        type: 'CHECKBOX',
        page: 1,
        x: 0.2,
        y: 0.2,
        width: 0.03,
        height: 0.03,
        required: false,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'two-recipients-a',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'two-recipients-b',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/two-recipients-a/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'two-recipients-a' }),
    });
    expect(response.status).toBe(200);

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('IN_PROGRESS');
  });

  it('auto-fills a DATE_SIGNED field on completion', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h9',
        storageKey: 'h9.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h9.pdf', pdfBytes);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const dateField = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'DATE_SIGNED',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.15,
        height: 0.04,
        required: true,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'date-token',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/date-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'date-token' }),
    });
    expect(response.status).toBe(200);

    const value = await prisma.fieldValue.findUnique({ where: { fieldId: dateField.id } });
    expect(value?.dateValue).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: FAIL — route module not found (the new `complete` cases; earlier `describe` blocks still pass).

- [ ] **Step 3: Write `src/app/api/sign/[token]/complete/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { flattenPdf, type FlattenFieldInput } from '@/lib/pdf/flatten';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

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
  });

  const remainingPending = await prisma.recipient.count({
    where: { documentId: recipient.documentId, status: 'PENDING' },
  });

  if (remainingPending === 0) {
    try {
      const allFields = await prisma.field.findMany({
        where: { documentId: recipient.documentId },
        include: { value: true },
      });

      const flattenInputs: FlattenFieldInput[] = [];
      for (const field of allFields) {
        let signaturePng: Buffer | null = null;
        if (field.value?.signatureImageKey) {
          signaturePng = await getSignatureStorage().read(field.value.signatureImageKey);
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
      const completedKey = `${sha256Hex(flattenedBytes)}-completed.pdf`;
      await getDocumentStorage().save(completedKey, flattenedBytes);

      await prisma.document.update({
        where: { id: recipient.documentId },
        data: { status: 'COMPLETED', completedPdfKey: completedKey },
      });
    } catch (error) {
      console.error('PDF flattening failed after final recipient completed', error);
      await prisma.document.update({
        where: { id: recipient.documentId },
        data: { status: 'IN_PROGRESS' },
      });
    }
  } else {
    await prisma.document.update({
      where: { id: recipient.documentId },
      data: { status: 'IN_PROGRESS' },
    });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/sign/[token]/complete" tests/integration/sign-session-api.test.ts
git commit -m "Add signing session complete API: required-field validation, date auto-fill, PDF flattening"
```

---

### Task 11: Decline API

**Files:**
- Create: `src/app/api/sign/[token]/decline/route.ts`
- Test: append to `tests/integration/sign-session-api.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `POST /api/sign/:token/decline` — consumed by Task 16 (signing session UI).

- [ ] **Step 1: Append the failing test cases**

Add `import * as declineRoute from '@/app/api/sign/[token]/decline/route';` to the top of `tests/integration/sign-session-api.test.ts`, then append:

```ts
describe('POST /api/sign/:token/decline', () => {
  it('declines a recipient and sets the document to DECLINED', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h10',
        storageKey: 'h10.pdf',
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
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'decline-token',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/decline-token/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Terms have changed' }),
    });
    const response = await declineRoute.POST(request, {
      params: Promise.resolve({ token: 'decline-token' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipient = await prisma.recipient.findUnique({ where: { id: recipient.id } });
    expect(reloadedRecipient?.status).toBe('DECLINED');
    expect(reloadedRecipient?.declineReason).toBe('Terms have changed');

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('DECLINED');
  });

  it('rejects declining an already-finished recipient', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h11',
        storageKey: 'h11.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'already-signed-token',
        status: 'SIGNED',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/already-signed-token/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await declineRoute.POST(request, {
      params: Promise.resolve({ token: 'already-signed-token' }),
    });
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: FAIL — route module not found (the new `decline` cases).

- [ ] **Step 3: Write `src/app/api/sign/[token]/decline/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));

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

  await prisma.$transaction([
    prisma.recipient.update({
      where: { id: recipient.id },
      data: { status: 'DECLINED', declinedAt: now, declineReason: reason },
    }),
    prisma.document.update({
      where: { id: recipient.documentId },
      data: { status: 'DECLINED' },
    }),
  ]);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/sign-session-api.test.ts`
Expected: PASS (11 tests total).

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: all tests pass together.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/sign/[token]/decline" tests/integration/sign-session-api.test.ts
git commit -m "Add signing session decline API"
```

---

### Task 12: Serve the completed PDF from the existing file route

**Files:**
- Modify: `src/app/api/documents/[id]/file/route.ts`
- Test: append to `tests/integration/documents-api.test.ts`

**Interfaces:**
- No new exports — behavioral change only. Consumed transparently by Phase 1's PDF viewer, with zero client-side changes.

- [ ] **Step 1: Append the failing test case**

Add this test to the end of the existing `describe('documents API', ...)` block in `tests/integration/documents-api.test.ts` (add `import { getDocumentStorage } from '@/lib/storage';` to the top if not already imported — check first, Phase 1's file already imports it for other tests in this suite):

```ts
  it('serves the completedPdfKey instead of the original storageKey once set', async () => {
    const { body: document } = await uploadPdf('completed-source.pdf', 1);
    const completedBytes = Buffer.from('%PDF-1.4\ncompleted-marker');
    await getDocumentStorage().save('completed-marker.pdf', completedBytes);
    await prisma.document.update({
      where: { id: document.id },
      data: { completedPdfKey: 'completed-marker.pdf' },
    });

    const fileRequest = new NextRequest(`http://localhost/api/documents/${document.id}/file`);
    const fileResponse = await fileRoute.GET(fileRequest, {
      params: Promise.resolve({ id: document.id }),
    });
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    expect(bytes.equals(completedBytes)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/documents-api.test.ts`
Expected: FAIL — the route still serves `storageKey`, so the returned bytes are the original upload, not `completedBytes`.

- [ ] **Step 3: Modify `src/app/api/documents/[id]/file/route.ts`**

Find:

```ts
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  const bytes = await getDocumentStorage().read(document.storageKey);
```

Replace with:

```ts
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  const bytes = await getDocumentStorage().read(document.completedPdfKey ?? document.storageKey);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/documents-api.test.ts`
Expected: PASS (all cases, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/documents/[id]/file/route.ts tests/integration/documents-api.test.ts
git commit -m "Serve the flattened signed PDF once a document completes"
```

---

### Task 13: Documents list API adds recipient progress counts

**Files:**
- Modify: `src/app/api/documents/route.ts`
- Test: append to `tests/integration/documents-api.test.ts`

**Interfaces:**
- Produces: `GET /api/documents` responses now include `recipientCount: number` and `signedCount: number` per document — consumed by Task 17 (dashboard).

- [ ] **Step 1: Append the failing test case**

Add to the end of `tests/integration/documents-api.test.ts`'s `describe('documents API', ...)` block:

```ts
  it('includes recipientCount and signedCount in the list response', async () => {
    const { body: document } = await uploadPdf('progress-doc.pdf', 1);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'progress-token-a',
        status: 'SIGNED',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'progress-token-b',
        status: 'PENDING',
      },
    });

    const listRequest = new NextRequest('http://localhost/api/documents?folderId=root');
    const list = await (await documentsRoute.GET(listRequest)).json();
    const found = list.find((d: { id: string }) => d.id === document.id);
    expect(found.recipientCount).toBe(2);
    expect(found.signedCount).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/documents-api.test.ts`
Expected: FAIL — `recipientCount`/`signedCount` are `undefined` on the current response.

- [ ] **Step 3: Modify `src/app/api/documents/route.ts`'s `GET` handler**

Find:

```ts
export async function GET(request: NextRequest) {
  const folderId = request.nextUrl.searchParams.get('folderId');
  const where =
    folderId === null ? {} : folderId === 'root' ? { folderId: null } : { folderId };
  const documents = await prisma.document.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json(documents);
}
```

Replace with:

```ts
export async function GET(request: NextRequest) {
  const folderId = request.nextUrl.searchParams.get('folderId');
  const where =
    folderId === null ? {} : folderId === 'root' ? { folderId: null } : { folderId };
  const documents = await prisma.document.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { recipients: { select: { status: true } } },
  });
  const withCounts = documents.map(({ recipients, ...rest }) => ({
    ...rest,
    recipientCount: recipients.length,
    signedCount: recipients.filter((r) => r.status === 'SIGNED').length,
  }));
  return NextResponse.json(withCounts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/documents-api.test.ts`
Expected: PASS (all cases, including the new one).

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: all tests pass together.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/documents/route.ts tests/integration/documents-api.test.ts
git commit -m "Add recipient progress counts to the documents list API"
```

---

### Task 14: Send UI

**Files:**
- Create: `src/app/documents/[id]/send/page.tsx`
- Create: `src/app/documents/[id]/send/send-client.tsx`

**Interfaces:**
- Consumes: `POST /api/documents/:id/send` (Task 7), `prisma` (for the server-component data fetch).
- Produces: route `/documents/:id/send` — consumed by Task 17 (dashboard entry point).

- [ ] **Step 1: Write `src/app/documents/[id]/send/send-client.tsx`**

```tsx
'use client';

import { useState } from 'react';

interface SignerRoleSummary {
  id: string;
  name: string;
}

interface SendClientProps {
  documentId: string;
  title: string;
  signerRoles: SignerRoleSummary[];
  status: string;
}

interface RecipientLink {
  id: string;
  name: string;
  signingToken: string;
}

export function SendClient({ documentId, title, signerRoles, status }: SendClientProps) {
  const [assignments, setAssignments] = useState<Record<string, { name: string; email: string }>>(
    Object.fromEntries(signerRoles.map((r) => [r.id, { name: '', email: '' }]))
  );
  const [links, setLinks] = useState<RecipientLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (status !== 'DRAFT' && !links) {
    return (
      <div className="p-6">
        <p>This document has already been sent.</p>
      </div>
    );
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignments: signerRoles.map((role) => ({
          signerRoleId: role.id,
          name: assignments[role.id].name,
          email: assignments[role.id].email,
        })),
      }),
    });
    setSending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to send' }));
      setError(body.error ?? 'Failed to send');
      return;
    }
    const body = await response.json();
    setLinks(body.recipients);
  }

  if (links) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-lg font-semibold">Signing links for &quot;{title}&quot;</h1>
        <ul className="flex flex-col gap-3">
          {links.map((recipient) => {
            const url = `${window.location.origin}/sign/${recipient.signingToken}`;
            return (
              <li key={recipient.id} className="rounded border p-3">
                <p className="font-medium">{recipient.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <input readOnly value={url} className="flex-1 rounded border px-2 py-1 text-xs" />
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => navigator.clipboard.writeText(url)}
                  >
                    Copy
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-lg font-semibold">Send &quot;{title}&quot;</h1>
      <div className="flex flex-col gap-4">
        {signerRoles.map((role) => (
          <div key={role.id} className="rounded border p-3">
            <p className="mb-2 text-sm font-medium">{role.name}</p>
            <input
              placeholder="Name"
              className="mb-2 w-full rounded border px-2 py-1 text-sm"
              value={assignments[role.id]?.name ?? ''}
              onChange={(event) =>
                setAssignments((prev) => ({
                  ...prev,
                  [role.id]: { ...prev[role.id], name: event.target.value },
                }))
              }
            />
            <input
              placeholder="Email"
              type="email"
              className="w-full rounded border px-2 py-1 text-sm"
              value={assignments[role.id]?.email ?? ''}
              onChange={(event) =>
                setAssignments((prev) => ({
                  ...prev,
                  [role.id]: { ...prev[role.id], email: event.target.value },
                }))
              }
            />
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={sending}
          onClick={handleSend}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/documents/[id]/send/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { SendClient } from './send-client';

export default async function SendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { signerRoles: { orderBy: { order: 'asc' } } },
  });
  if (!document) notFound();
  return (
    <SendClient
      documentId={document.id}
      title={document.title}
      signerRoles={document.signerRoles}
      status={document.status}
    />
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/documents/[id]/send
git commit -m "Add Send UI: assign recipients, display signing links"
```

---

### Task 15: SignaturePad component

**Files:**
- Create: `src/components/signature-pad.tsx`

**Interfaces:**
- Produces: `<SignaturePad onSave={(blob: Blob) => void} width? height? />` — consumed by Task 16 (signing session UI).

- [ ] **Step 1: Write `src/components/signature-pad.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';

interface SignaturePadProps {
  onSave: (blob: Blob) => void;
  width?: number;
  height?: number;
}

export function SignaturePad({ onSave, width = 300, height = 100 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  function getContext() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }

  function getPos(event: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in event) {
      const touch = event.touches[0];
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: React.MouseEvent | React.TouchEvent) {
    drawing.current = true;
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = getPos(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(event: React.MouseEvent | React.TouchEvent) {
    if (!drawing.current) return;
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = getPos(event);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    setHasDrawn(true);
  }

  function stopDrawing() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) onSave(blob);
    }, 'image/png');
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="cursor-crosshair rounded border bg-white"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      <div className="flex gap-2 text-xs">
        <button onClick={clear} className="underline">
          Clear
        </button>
        <button
          disabled={!hasDrawn}
          onClick={save}
          className="rounded border px-2 py-1 disabled:opacity-50"
        >
          Save signature
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/signature-pad.tsx
git commit -m "Add SignaturePad: draw-only signature capture canvas"
```

---

### Task 16: Signing session UI

**Files:**
- Create: `src/app/sign/[token]/sign-client.tsx`
- Create: `src/app/sign/[token]/page.tsx`

**Interfaces:**
- Consumes: `<SignaturePad>` (Task 15), `FIELD_TYPE_LABELS` (`@/lib/fields/field-defaults`, Phase 2), `GET /api/sign/:token`, `PATCH /api/sign/:token/fields/:fieldId`, `POST /api/sign/:token/complete`, `POST /api/sign/:token/decline` (Tasks 8-11).
- Produces: route `/sign/:token`.

- [ ] **Step 1: Write `src/app/sign/[token]/sign-client.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { SignaturePad } from '@/components/signature-pad';
import { FIELD_TYPE_LABELS } from '@/lib/fields/field-defaults';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface FieldValueRecord {
  textValue: string | null;
  checked: boolean | null;
  signatureImageKey: string | null;
  dateValue: string | null;
}

interface FieldRecord {
  id: string;
  type: 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'TEXT' | 'CHECKBOX';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  value: FieldValueRecord | null;
}

interface SessionData {
  recipient: { id: string; name: string; status: string; declineReason: string | null };
  document: { id: string; title: string; pageCount: number; status: string };
  fields: FieldRecord[];
}

interface SignClientProps {
  token: string;
}

export function SignClient({ token }: SignClientProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [activeSignatureFieldId, setActiveSignatureFieldId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const pageRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  const loadSession = useCallback(async () => {
    const response = await fetch(`/api/sign/${token}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Signing link not found' }));
      setLoadError(body.error ?? 'Signing link not found');
      return;
    }
    setSession(await response.json());
  }, [token]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    pdfjsLib.getDocument(`/api/documents/${session.document.id}/file`).promise.then((doc) => {
      if (cancelled) return;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const renderPage = useCallback(async (pageNumber: number) => {
    const doc = pdfDocRef.current;
    const canvas = pageRefs.current[pageNumber];
    if (!doc || !canvas) return;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d')!;
    await page.render({ canvasContext: context, viewport }).promise;
  }, []);

  useEffect(() => {
    for (let page = 1; page <= numPages; page += 1) {
      renderPage(page);
    }
  }, [numPages, renderPage]);

  async function saveTextValue(fieldId: string, textValue: string) {
    await fetch(`/api/sign/${token}/fields/${fieldId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue }),
    });
    loadSession();
  }

  async function saveChecked(fieldId: string, checked: boolean) {
    await fetch(`/api/sign/${token}/fields/${fieldId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked }),
    });
    loadSession();
  }

  async function saveSignature(fieldId: string, blob: Blob) {
    const formData = new FormData();
    formData.append('image', blob, 'signature.png');
    await fetch(`/api/sign/${token}/fields/${fieldId}`, { method: 'PATCH', body: formData });
    setActiveSignatureFieldId(null);
    loadSession();
  }

  async function handleComplete() {
    setCompleting(true);
    const response = await fetch(`/api/sign/${token}/complete`, { method: 'POST' });
    setCompleting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to complete' }));
      window.alert(body.error ?? 'Failed to complete');
      return;
    }
    loadSession();
  }

  async function handleDecline() {
    if (!window.confirm('Are you sure you want to decline to sign this document?')) return;
    const reason = window.prompt('Reason (optional):') ?? undefined;
    const response = await fetch(`/api/sign/${token}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to decline' }));
      window.alert(body.error ?? 'Failed to decline');
      return;
    }
    loadSession();
  }

  if (loadError) {
    return <div className="p-6 text-center text-neutral-500">{loadError}</div>;
  }

  if (!session) {
    return <div className="p-6 text-center text-neutral-500">Loading...</div>;
  }

  if (session.recipient.status === 'SIGNED') {
    return <div className="p-6 text-center">You already signed this document. Thank you!</div>;
  }

  if (session.recipient.status === 'DECLINED') {
    return <div className="p-6 text-center">You declined to sign this document.</div>;
  }

  if (session.document.status === 'DECLINED') {
    return (
      <div className="p-6 text-center">
        This document was declined by another signer and can no longer be signed.
      </div>
    );
  }

  const allRequiredFilled = session.fields
    .filter((f) => f.required && f.type !== 'DATE_SIGNED')
    .every((f) => f.value !== null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-medium">{session.document.title}</h1>
        <div className="flex gap-2">
          <button onClick={handleDecline} className="rounded border px-3 py-1.5 text-sm text-red-600">
            Decline to Sign
          </button>
          <button
            disabled={!allRequiredFilled || completing}
            onClick={handleComplete}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {completing ? 'Completing...' : 'Complete Signing'}
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto bg-neutral-100 p-6">
        <div className="flex flex-col items-center gap-6">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
            <div key={page} className="relative shadow">
              <canvas
                ref={(el) => {
                  pageRefs.current[page] = el;
                }}
              />
              {session.fields
                .filter((f) => f.page === page)
                .map((field) => (
                  <div
                    key={field.id}
                    className="absolute flex items-center justify-center border-2 border-blue-600 bg-blue-100/40"
                    style={{
                      left: `${field.x * 100}%`,
                      top: `${field.y * 100}%`,
                      width: `${field.width * 100}%`,
                      height: `${field.height * 100}%`,
                    }}
                  >
                    {(field.type === 'SIGNATURE' || field.type === 'INITIALS') && (
                      <>
                        {field.value?.signatureImageKey ? (
                          <span className="text-[10px] text-green-700">Signed ✓</span>
                        ) : (
                          <button
                            className="text-[10px] underline"
                            onClick={() => setActiveSignatureFieldId(field.id)}
                          >
                            {FIELD_TYPE_LABELS[field.type]}
                          </button>
                        )}
                        {activeSignatureFieldId === field.id && (
                          <div className="absolute left-0 top-full z-10 mt-2 rounded border bg-white p-2 shadow">
                            <SignaturePad onSave={(blob) => saveSignature(field.id, blob)} />
                          </div>
                        )}
                      </>
                    )}
                    {field.type === 'TEXT' && (
                      <input
                        defaultValue={field.value?.textValue ?? ''}
                        onBlur={(event) => saveTextValue(field.id, event.target.value)}
                        className="h-full w-full bg-transparent px-1 text-[10px] outline-none"
                      />
                    )}
                    {field.type === 'CHECKBOX' && (
                      <input
                        type="checkbox"
                        defaultChecked={field.value?.checked ?? false}
                        onChange={(event) => saveChecked(field.id, event.target.checked)}
                      />
                    )}
                    {field.type === 'DATE_SIGNED' && (
                      <span className="text-[9px] text-neutral-500">Date signed (auto)</span>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/sign/[token]/page.tsx`**

```tsx
import { SignClient } from './sign-client';

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignClient token={token} />;
}
```

- [ ] **Step 3: Manual verification**

Run: `./scripts/setup-db.sh && npm run db:generate && npm run dev`
Upload a document, place a required Signature field, send it to yourself, open the generated `/sign/:token` link, draw a signature, complete signing, confirm the document becomes Completed and `/documents/:id` now shows the flattened PDF with the drawn signature visible. Stop the dev server afterward.

- [ ] **Step 4: Commit**

```bash
git add "src/app/sign"
git commit -m "Add signing session UI: field overlay, signature capture, complete/decline"
```

---

### Task 17: Dashboard — recipient progress hint and Send entry point

**Files:**
- Modify: `src/components/document-grid.tsx`

**Interfaces:**
- Consumes: `recipientCount`/`signedCount` from `GET /api/documents` (Task 13).

- [ ] **Step 1: Add `recipientCount`/`signedCount` to `DocumentSummary`**

Find:

```ts
export interface DocumentSummary {
  id: string;
  title: string;
  status: string;
  thumbnailKey: string | null;
  updatedAt: string;
  folderId: string | null;
}
```

Replace with:

```ts
export interface DocumentSummary {
  id: string;
  title: string;
  status: string;
  thumbnailKey: string | null;
  updatedAt: string;
  folderId: string | null;
  recipientCount?: number;
  signedCount?: number;
}
```

- [ ] **Step 2: Show a progress hint and a Send link**

Find:

```tsx
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-neutral-500">{STATUS_LABELS[doc.status]}</p>
              </div>
            </Link>
            {doc.status === 'DRAFT' && (
              <Link href={`/documents/${doc.id}/edit`} className="text-xs underline">
                Edit fields
              </Link>
            )}
          </div>
```

Replace with:

```tsx
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-neutral-500">
                  {STATUS_LABELS[doc.status]}
                  {(doc.status === 'SENT' || doc.status === 'IN_PROGRESS') &&
                    typeof doc.recipientCount === 'number' && (
                      <>
                        {' '}
                        · {doc.signedCount ?? 0} of {doc.recipientCount} signed
                      </>
                    )}
                </p>
              </div>
            </Link>
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
          </div>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/document-grid.tsx
git commit -m "Show recipient progress and a Send entry point on the dashboard"
```

---

### Task 18: Manual end-to-end browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

Run: `./scripts/setup-db.sh && npm run db:generate && npm run dev`
Open `http://localhost:3000`.

- [ ] **Step 2: Prepare a document with two signer roles**

Upload a real multi-page PDF from the dashboard. Open its field editor. Add a Signature field (required) under "Signer 1" and a Text field (required) under a newly-added "Signer 2". Return to the dashboard.

- [ ] **Step 3: Send it**

Click "Send" on the Draft document card. Fill in name/email for both signer roles. Submit. Confirm two signing links appear with working Copy buttons.

- [ ] **Step 4: Complete the first recipient's session**

Open Signer 1's link in a new tab. Confirm only the Signature field is shown (not Signer 2's Text field). Draw a signature, save it. Confirm "Complete Signing" is enabled once the signature is saved. Click it. Confirm a "you already signed" confirmation appears if you reload the link.

- [ ] **Step 5: Verify IN_PROGRESS state**

Back on the dashboard, confirm the document now shows "In Progress" with a "1 of 2 signed" hint.

- [ ] **Step 6: Complete the second recipient's session**

Open Signer 2's link. Confirm only the Text field is shown. Type a value, tab out (triggers auto-save). Click "Complete Signing".

- [ ] **Step 7: Verify COMPLETED state and the flattened PDF**

On the dashboard, confirm the document now shows "Completed". Click into the document's viewer (`/documents/:id`) and confirm the rendered PDF shows the drawn signature and typed text baked into the page at the correct positions.

- [ ] **Step 8: Verify locking**

Attempt to visit `/documents/:id/edit` for the now-completed document. Confirm field editing is no longer possible (either redirected or the API rejects any attempted change — check via the browser's network tab if the UI doesn't visibly block it).

- [ ] **Step 9: Verify decline**

Send a second test document to a single recipient. Open their signing link and click "Decline to Sign" with a reason. Confirm the dashboard shows the document as "Declined", and confirm re-opening the same link shows the declined confirmation rather than an editable form.

- [ ] **Step 10: Record results**

If every step above matches its expected result, Phase 3 is complete. If any step fails, note it before starting Phase 4.

