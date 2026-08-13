# Phase 2: Templates & Field Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user drag-and-drop signature/form fields onto a PDF (either a reusable Template or a specific Document), organize a Templates library, and instantiate a Document from a Template with its field layout copied over.

**Architecture:** Extends the existing Next.js 15 App Router + Prisma/Postgres + local-filesystem-storage stack from Phase 1. `SignerRole` and `Field` are shared tables with nullable `templateId`/`documentId` (exactly one set) so one API surface and one `<FieldEditor>` component serve both a Template and a Document. Field positions are stored as fractions of page width/height. Template upload reuses Phase 1's hash/validate/thumbnail pipeline verbatim.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Prisma 6 + PostgreSQL, `pdfjs-dist` (already installed), Vitest.

## Global Constraints

- No auth, login, signup, accounts, sessions, orgs, teams, roles (user-facing), permissions, multi-tenancy, billing, or API keys.
- No placeholder implementations, no `TODO`s, no mocked features — every task ships a complete, working slice.
- `SignerRole`/`Field` rows always have exactly one of `templateId`/`documentId` set — never both, never neither — enforced at the application layer.
- Field coordinates (`x`, `y`, `width`, `height`) are always fractions in `[0, 1]`, clamped server-side so `x + width <= 1` and `y + height <= 1`.
- All routes follow Phase 1's `{ error: string }` response-shape convention for handled errors.
- All file I/O continues to go through the `StorageAdapter` interface (`@/lib/storage`) — never direct `fs` calls.
- Git remote: `https://github.com/zachb02/esign.git`. Commit at the end of every task. Do not add a `Co-Authored-By` trailer to commit messages.
- Templates have no folder organization (flat list) — do not add a `folderId` to `Template`.

---

### Task 1: Prisma schema — FieldType, Template, SignerRole, Field

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_phase2_fields/migration.sql` (generated)

**Interfaces:**
- Produces: `FieldType` enum (`SIGNATURE | INITIALS | DATE_SIGNED | TEXT | CHECKBOX`), `Template`, `SignerRole`, `Field` Prisma models, and `Document.signerRoles`/`Document.fields` back-relations — consumed by every later task.

- [ ] **Step 1: Add the new models to `prisma/schema.prisma`**

Add this enum and these three models, and add two back-relation fields to the existing `Document` model:

```prisma
enum FieldType {
  SIGNATURE
  INITIALS
  DATE_SIGNED
  TEXT
  CHECKBOX
}

model Template {
  id               String       @id @default(cuid())
  title            String
  originalFilename String
  fileHash         String
  storageKey       String
  thumbnailKey     String?
  pageCount        Int
  fileSizeBytes    Int
  signerRoles      SignerRole[]
  fields           Field[]
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
}

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

In the existing `Document` model, add these two back-relation lines (alongside the existing `folder`/`documents` relations, anywhere in the field list):

```prisma
  signerRoles      SignerRole[]
  fields           Field[]
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name phase2_fields`
Expected: creates a new migration adding the `FieldType` enum and the three tables plus FKs, applies it to `esign_app`, regenerates the Prisma client.

- [ ] **Step 3: Apply the same migration to the test database**

Run: `DATABASE_URL="postgresql://zachbar@localhost:5432/esign_app_test" npx prisma migrate deploy`
Expected: applies the same migration to `esign_app_test` without prompting to create a new one.

- [ ] **Step 4: Verify**

Run: `npx prisma migrate status` (against the default `.env`) and again with `DATABASE_URL` pointed at `esign_app_test`.
Expected: "Database schema is up to date!" for both.
Run: `npx tsc --noEmit`
Expected: no errors (confirms the regenerated Prisma client's types are consistent with the rest of the codebase).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Template, SignerRole, and Field models for Phase 2"
```

---

### Task 2: Field domain pure functions — clamping, default sizes, role colors, reassignment

**Files:**
- Create: `src/lib/fields/clamp.ts`
- Create: `src/lib/fields/field-defaults.ts`
- Create: `src/lib/fields/role-reassignment.ts`
- Test: `src/lib/fields/clamp.test.ts`
- Test: `src/lib/fields/role-reassignment.test.ts`

**Interfaces:**
- Produces: `clampFieldRect(rect: FieldRect): FieldRect`, `DEFAULT_FIELD_SIZE: Record<FieldType, {width: number; height: number}>`, `ROLE_COLORS: string[]`, `getRoleColor(index: number): string`, `pickReassignmentRole(roles: RoleRecord[], deletedRoleId: string): RoleRecord | null` — consumed by Task 6 (fields API) and Task 5 (signer-roles API).

- [ ] **Step 1: Write the failing clamp test**

```ts
// src/lib/fields/clamp.test.ts
import { describe, expect, it } from 'vitest';
import { clampFieldRect } from './clamp';

describe('clampFieldRect', () => {
  it('leaves an in-bounds rect unchanged', () => {
    expect(clampFieldRect({ x: 0.1, y: 0.2, width: 0.25, height: 0.06 })).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.06,
    });
  });

  it('clamps negative x/y to 0', () => {
    expect(clampFieldRect({ x: -0.5, y: -0.2, width: 0.2, height: 0.05 })).toEqual({
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.05,
    });
  });

  it('clamps width/height so x + width and y + height never exceed 1', () => {
    expect(clampFieldRect({ x: 0.9, y: 0.95, width: 0.3, height: 0.3 })).toEqual({
      x: 0.9,
      y: 0.95,
      width: 0.1,
      height: 0.05,
    });
  });

  it('clamps x/y that are already >= 1 down to a valid position', () => {
    expect(clampFieldRect({ x: 1.5, y: 2, width: 0.2, height: 0.1 })).toEqual({
      x: 0.8,
      y: 0.9,
      width: 0.2,
      height: 0.1,
    });
  });

  it('clamps a width/height of 0 or negative up to a tiny positive minimum', () => {
    const result = clampFieldRect({ x: 0.1, y: 0.1, width: 0, height: -0.5 });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fields/clamp.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `clamp.ts`**

```ts
// src/lib/fields/clamp.ts
export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 0.01;

export function clampFieldRect(rect: FieldRect): FieldRect {
  const width = Math.min(1, Math.max(MIN_SIZE, rect.width));
  const height = Math.min(1, Math.max(MIN_SIZE, rect.height));
  const x = Math.min(Math.max(0, rect.x), 1 - width);
  const y = Math.min(Math.max(0, rect.y), 1 - height);
  return { x, y, width, height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fields/clamp.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write `field-defaults.ts` (no test — a static data module)**

```ts
// src/lib/fields/field-defaults.ts
import type { FieldType } from '@prisma/client';

export const DEFAULT_FIELD_SIZE: Record<FieldType, { width: number; height: number }> = {
  SIGNATURE: { width: 0.25, height: 0.06 },
  INITIALS: { width: 0.1, height: 0.06 },
  DATE_SIGNED: { width: 0.15, height: 0.04 },
  TEXT: { width: 0.2, height: 0.04 },
  CHECKBOX: { width: 0.03, height: 0.03 },
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date Signed',
  TEXT: 'Text',
  CHECKBOX: 'Checkbox',
};

export const ROLE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#9333ea',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

export function getRoleColor(index: number): string {
  return ROLE_COLORS[index % ROLE_COLORS.length];
}
```

- [ ] **Step 6: Write the failing role-reassignment test**

```ts
// src/lib/fields/role-reassignment.test.ts
import { describe, expect, it } from 'vitest';
import { pickReassignmentRole } from './role-reassignment';

const roles = [
  { id: 'r1', order: 0 },
  { id: 'r2', order: 1 },
  { id: 'r3', order: 2 },
];

describe('pickReassignmentRole', () => {
  it('picks the next role by order after the deleted one', () => {
    expect(pickReassignmentRole(roles, 'r1')?.id).toBe('r2');
  });

  it('wraps to an earlier role if the deleted one was last by order', () => {
    expect(pickReassignmentRole(roles, 'r3')?.id).toBe('r2');
  });

  it('returns null when the deleted role is the only role', () => {
    expect(pickReassignmentRole([{ id: 'only', order: 0 }], 'only')).toBeNull();
  });

  it('returns null when the deleted role id is not found', () => {
    expect(pickReassignmentRole(roles, 'missing')).not.toBeNull();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/lib/fields/role-reassignment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Write `role-reassignment.ts`**

```ts
// src/lib/fields/role-reassignment.ts
export interface RoleOrderRecord {
  id: string;
  order: number;
}

export function pickReassignmentRole<T extends RoleOrderRecord>(
  roles: T[],
  deletedRoleId: string
): T | null {
  const remaining = roles.filter((r) => r.id !== deletedRoleId);
  if (remaining.length === 0) return null;
  const sorted = [...remaining].sort((a, b) => a.order - b.order);
  const deleted = roles.find((r) => r.id === deletedRoleId);
  if (!deleted) return sorted[0];
  const next = sorted.find((r) => r.order > deleted.order);
  return next ?? sorted[sorted.length - 1];
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/lib/fields/role-reassignment.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/fields
git commit -m "Add field clamping, default sizes, role colors, and role-reassignment logic"
```

---

### Task 3: Templates API — upload, list, get, rename, delete, file, thumbnail

**Files:**
- Create: `src/app/api/templates/route.ts`
- Create: `src/app/api/templates/[id]/route.ts`
- Create: `src/app/api/templates/[id]/file/route.ts`
- Create: `src/app/api/templates/[id]/thumbnail/route.ts`
- Test: `tests/integration/templates-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getDocumentStorage`/`getThumbnailStorage` (`@/lib/storage`), `sha256Hex`, `assertValidPdf`/`InvalidPdfError`, `getPdfPageCount`/`renderPdfPageToPng`, `makeTestPdf` (`tests/fixtures/make-test-pdf`) — all from Phase 1, unmodified.
- Produces: `POST/GET /api/templates`, `GET/PATCH/DELETE /api/templates/:id`, `GET /api/templates/:id/file`, `GET /api/templates/:id/thumbnail` — consumed by Task 7 (templates UI) and Task 10 (field editor routes).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/templates-api.test.ts
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/db/prisma';
import { makeTestPdf } from '../fixtures/make-test-pdf';
import * as templatesRoute from '@/app/api/templates/route';
import * as templateRoute from '@/app/api/templates/[id]/route';
import * as fileRoute from '@/app/api/templates/[id]/file/route';
import * as thumbnailRoute from '@/app/api/templates/[id]/thumbnail/route';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'esign-templates-test-'));
  process.env.ESIGN_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.template.deleteMany();
});

afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ESIGN_DATA_DIR;
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.template.deleteMany();
  await prisma.$disconnect();
});

async function uploadTemplate(fileName: string, pageCount = 2) {
  const pdfBytes = await makeTestPdf(pageCount);
  const formData = new FormData();
  formData.append('file', new File([pdfBytes], fileName, { type: 'application/pdf' }));
  const request = new NextRequest('http://localhost/api/templates', {
    method: 'POST',
    body: formData,
  });
  const response = await templatesRoute.POST(request);
  return { response, body: await response.json() };
}

describe('templates API', () => {
  it('rejects a non-PDF upload', async () => {
    const formData = new FormData();
    formData.append('file', new File([Buffer.from('not a pdf')], 'fake.pdf', { type: 'application/pdf' }));
    const request = new NextRequest('http://localhost/api/templates', {
      method: 'POST',
      body: formData,
    });
    const response = await templatesRoute.POST(request);
    expect(response.status).toBe(400);
    expect(await prisma.template.count()).toBe(0);
  });

  it('uploads a valid PDF and returns it in the list', async () => {
    const { response, body } = await uploadTemplate('nda.pdf', 3);
    expect(response.status).toBe(201);
    expect(body.pageCount).toBe(3);

    const listResponse = await templatesRoute.GET();
    const list = await listResponse.json();
    expect(list.map((t: { id: string }) => t.id)).toContain(body.id);
  });

  it('renames a template', async () => {
    const { body: template } = await uploadTemplate('renamed.pdf');
    const patchRequest = new NextRequest(`http://localhost/api/templates/${template.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'NDA Template' }),
    });
    const patchResponse = await templateRoute.PATCH(patchRequest, {
      params: Promise.resolve({ id: template.id }),
    });
    expect((await patchResponse.json()).title).toBe('NDA Template');
  });

  it('serves the file and thumbnail, and deletes cleanly', async () => {
    const { body: template } = await uploadTemplate('serve.pdf');

    const fileRequest = new NextRequest(`http://localhost/api/templates/${template.id}/file`);
    const fileResponse = await fileRoute.GET(fileRequest, {
      params: Promise.resolve({ id: template.id }),
    });
    expect(fileResponse.headers.get('Content-Type')).toBe('application/pdf');

    const thumbRequest = new NextRequest(`http://localhost/api/templates/${template.id}/thumbnail`);
    const thumbResponse = await thumbnailRoute.GET(thumbRequest, {
      params: Promise.resolve({ id: template.id }),
    });
    expect(thumbResponse.status).toBe(200);

    const deleteRequest = new NextRequest(`http://localhost/api/templates/${template.id}`, {
      method: 'DELETE',
    });
    await templateRoute.DELETE(deleteRequest, { params: Promise.resolve({ id: template.id }) });
    expect(await prisma.template.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/templates-api.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write `src/app/api/templates/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getThumbnailStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { assertValidPdf, InvalidPdfError } from '@/lib/pdf/validate';
import { getPdfPageCount, renderPdfPageToPng } from '@/lib/pdf/render';

export async function GET() {
  const templates = await prisma.template.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { signerRoles: true } } },
  });
  return NextResponse.json(templates);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A file field is required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let pageCount: number;
  try {
    assertValidPdf(buffer);
    pageCount = await getPdfPageCount(buffer);
  } catch (error) {
    if (error instanceof InvalidPdfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'File is not a valid PDF' }, { status: 400 });
  }

  const fileHash = sha256Hex(buffer);
  const storageKey = `${fileHash}.pdf`;

  try {
    await getDocumentStorage().save(storageKey, buffer);
  } catch (error) {
    console.error('Failed to store uploaded template', error);
    return NextResponse.json({ error: 'Failed to store the uploaded file' }, { status: 500 });
  }

  let thumbnailKey: string | null = null;
  try {
    const thumbnailPng = await renderPdfPageToPng(buffer, 1);
    thumbnailKey = `${fileHash}.png`;
    await getThumbnailStorage().save(thumbnailKey, thumbnailPng);
  } catch (error) {
    console.error('Thumbnail generation failed', error);
    thumbnailKey = null;
  }

  const template = await prisma.template.create({
    data: {
      title: file.name.replace(/\.pdf$/i, ''),
      originalFilename: file.name,
      fileHash,
      storageKey,
      thumbnailKey,
      pageCount,
      fileSizeBytes: buffer.byteLength,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
```

- [ ] **Step 4: Write `src/app/api/templates/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
  }
  const updated = await prisma.template.update({ where: { id }, data: { title } });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  await prisma.template.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Write `src/app/api/templates/[id]/file/route.ts` and `.../thumbnail/route.ts`**

```ts
// src/app/api/templates/[id]/file/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  const bytes = await getDocumentStorage().read(template.storageKey);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(template.originalFilename)}"`,
    },
  });
}
```

```ts
// src/app/api/templates/[id]/thumbnail/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getThumbnailStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template || !template.thumbnailKey) {
    return NextResponse.json({ error: 'Thumbnail not available' }, { status: 404 });
  }
  const bytes = await getThumbnailStorage().read(template.thumbnailKey);
  return new NextResponse(bytes, { headers: { 'Content-Type': 'image/png' } });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/templates-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/templates tests/integration/templates-api.test.ts
git commit -m "Add templates API: upload, list, rename, delete, file/thumbnail streaming"
```

---

### Task 4: Signer-roles API

**Files:**
- Create: `src/app/api/signer-roles/route.ts`
- Create: `src/app/api/signer-roles/[id]/route.ts`
- Test: `tests/integration/signer-roles-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getRoleColor` (unused directly but `colorIndex` convention matches `@/lib/fields/field-defaults`), `pickReassignmentRole` (`@/lib/fields/role-reassignment`).
- Produces: `POST/GET /api/signer-roles`, `DELETE /api/signer-roles/:id` — consumed by Task 5 (fields API) and Task 10 (field editor).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/signer-roles-api.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as signerRolesRoute from '@/app/api/signer-roles/route';
import * as signerRoleRoute from '@/app/api/signer-roles/[id]/route';

beforeEach(async () => {
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.template.deleteMany();
});

afterAll(async () => {
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.template.deleteMany();
  await prisma.$disconnect();
});

async function createTemplate() {
  return prisma.template.create({
    data: {
      title: 'T',
      originalFilename: 't.pdf',
      fileHash: 'hash',
      storageKey: 'hash.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
    },
  });
}

async function createRole(request: NextRequest) {
  const response = await signerRolesRoute.POST(request);
  return { response, body: await response.json() };
}

describe('signer-roles API', () => {
  it('creates a role with an auto-generated name and increasing order', async () => {
    const template = await createTemplate();
    const request1 = new NextRequest('http://localhost/api/signer-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
    });
    const { body: role1 } = await createRole(request1);
    expect(role1.name).toBe('Signer 1');
    expect(role1.order).toBe(0);

    const request2 = new NextRequest('http://localhost/api/signer-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
    });
    const { body: role2 } = await createRole(request2);
    expect(role2.name).toBe('Signer 2');
    expect(role2.order).toBe(1);
  });

  it('lists roles for an owner via GET', async () => {
    const template = await createTemplate();
    await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    const listRequest = new NextRequest(
      `http://localhost/api/signer-roles?ownerType=template&ownerId=${template.id}`
    );
    const listResponse = await signerRolesRoute.GET(listRequest);
    const list = await listResponse.json();
    expect(list).toHaveLength(1);
  });

  it('rejects deleting the last remaining role', async () => {
    const template = await createTemplate();
    const { body: role } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    const deleteRequest = new NextRequest(`http://localhost/api/signer-roles/${role.id}`, {
      method: 'DELETE',
    });
    const deleteResponse = await signerRoleRoute.DELETE(deleteRequest, {
      params: Promise.resolve({ id: role.id }),
    });
    expect(deleteResponse.status).toBe(400);
  });

  it('reassigns fields to another role when a role with 2+ siblings is deleted', async () => {
    const template = await createTemplate();
    const { body: roleA } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    const { body: roleB } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    const field = await prisma.field.create({
      data: {
        templateId: template.id,
        signerRoleId: roleA.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.05,
      },
    });

    const deleteRequest = new NextRequest(`http://localhost/api/signer-roles/${roleA.id}`, {
      method: 'DELETE',
    });
    const deleteResponse = await signerRoleRoute.DELETE(deleteRequest, {
      params: Promise.resolve({ id: roleA.id }),
    });
    expect(deleteResponse.status).toBe(200);

    const reloaded = await prisma.field.findUnique({ where: { id: field.id } });
    expect(reloaded?.signerRoleId).toBe(roleB.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/signer-roles-api.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write `src/app/api/signer-roles/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(request: NextRequest) {
  const ownerType = request.nextUrl.searchParams.get('ownerType');
  const ownerId = request.nextUrl.searchParams.get('ownerId');
  if ((ownerType !== 'template' && ownerType !== 'document') || !ownerId) {
    return NextResponse.json(
      { error: 'ownerType and ownerId query params are required' },
      { status: 400 }
    );
  }
  const roles = await prisma.signerRole.findMany({
    where: ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId },
    orderBy: { order: 'asc' },
  });
  return NextResponse.json(roles);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ownerType = body.ownerType;
  const ownerId = typeof body.ownerId === 'string' ? body.ownerId : '';
  if (ownerType !== 'template' && ownerType !== 'document') {
    return NextResponse.json(
      { error: 'ownerType must be "template" or "document"' },
      { status: 400 }
    );
  }
  if (!ownerId) {
    return NextResponse.json({ error: 'ownerId is required' }, { status: 400 });
  }

  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }

  const existingCount = await prisma.signerRole.count({
    where: ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId },
  });

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : `Signer ${existingCount + 1}`;

  const role = await prisma.signerRole.create({
    data: {
      templateId: ownerType === 'template' ? ownerId : null,
      documentId: ownerType === 'document' ? ownerId : null,
      name,
      order: existingCount,
      colorIndex: existingCount,
    },
  });

  return NextResponse.json(role, { status: 201 });
}
```

- [ ] **Step 4: Write `src/app/api/signer-roles/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { pickReassignmentRole } from '@/lib/fields/role-reassignment';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.signerRole.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Signer role not found' }, { status: 404 });
  }

  const siblingWhere = existing.templateId
    ? { templateId: existing.templateId }
    : { documentId: existing.documentId };
  const siblings = await prisma.signerRole.findMany({ where: siblingWhere });

  const reassignTo = pickReassignmentRole(siblings, id);
  if (!reassignTo) {
    return NextResponse.json({ error: 'Cannot delete the last signer role' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.field.updateMany({
      where: { signerRoleId: id },
      data: { signerRoleId: reassignTo.id },
    }),
    prisma.signerRole.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/signer-roles-api.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/signer-roles tests/integration/signer-roles-api.test.ts
git commit -m "Add signer-roles API: create, list, delete with field reassignment"
```

---

### Task 5: Fields API

**Files:**
- Create: `src/app/api/fields/route.ts`
- Create: `src/app/api/fields/[id]/route.ts`
- Test: `tests/integration/fields-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `clampFieldRect` (`@/lib/fields/clamp`), `DEFAULT_FIELD_SIZE` (`@/lib/fields/field-defaults`).
- Produces: `POST/GET /api/fields`, `PATCH/DELETE /api/fields/:id` — consumed by Task 10 (field editor).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/fields-api.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as fieldsRoute from '@/app/api/fields/route';
import * as fieldRoute from '@/app/api/fields/[id]/route';

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

async function createTemplate() {
  return prisma.template.create({
    data: {
      title: 'T',
      originalFilename: 't.pdf',
      fileHash: 'hash',
      storageKey: 'hash.pdf',
      pageCount: 2,
      fileSizeBytes: 10,
    },
  });
}

async function createDocument() {
  return prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
      fileHash: 'dochash',
      storageKey: 'dochash.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'DRAFT',
    },
  });
}

describe('fields API', () => {
  it('creates a field on a Document owner (not just Template), auto-creating a role', async () => {
    const document = await createDocument();
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'document',
        ownerId: document.id,
        type: 'TEXT',
        page: 1,
        x: 0.2,
        y: 0.2,
      }),
    });
    const response = await fieldsRoute.POST(request);
    const field = await response.json();
    expect(response.status).toBe(201);
    expect(field.documentId).toBe(document.id);
    expect(field.templateId).toBeNull();

    const listRequest = new NextRequest(
      `http://localhost/api/fields?ownerType=document&ownerId=${document.id}`
    );
    const list = await (await fieldsRoute.GET(listRequest)).json();
    expect(list).toHaveLength(1);

    const patchRequest = new NextRequest(`http://localhost/api/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ required: false }),
    });
    const updated = await (
      await fieldRoute.PATCH(patchRequest, { params: Promise.resolve({ id: field.id }) })
    ).json();
    expect(updated.required).toBe(false);
  });

  it('creates a field and auto-creates a signer role when none exists', async () => {
    const template = await createTemplate();
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'template',
        ownerId: template.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
      }),
    });
    const response = await fieldsRoute.POST(request);
    const field = await response.json();
    expect(response.status).toBe(201);
    expect(field.width).toBeCloseTo(0.25);
    expect(field.height).toBeCloseTo(0.06);

    const role = await prisma.signerRole.findUnique({ where: { id: field.signerRoleId } });
    expect(role?.name).toBe('Signer 1');
  });

  it('clamps out-of-bounds coordinates', async () => {
    const template = await createTemplate();
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'template',
        ownerId: template.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.95,
        y: 0.98,
      }),
    });
    const response = await fieldsRoute.POST(request);
    const field = await response.json();
    expect(field.x + field.width).toBeLessThanOrEqual(1);
    expect(field.y + field.height).toBeLessThanOrEqual(1);
  });

  it('rejects an invalid field type', async () => {
    const template = await createTemplate();
    const request = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'template',
        ownerId: template.id,
        type: 'NOT_A_TYPE',
        page: 1,
        x: 0.1,
        y: 0.1,
      }),
    });
    const response = await fieldsRoute.POST(request);
    expect(response.status).toBe(400);
  });

  it('updates position via PATCH, clamped', async () => {
    const template = await createTemplate();
    const createRequest = new NextRequest('http://localhost/api/fields', {
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
    const field = await (await fieldsRoute.POST(createRequest)).json();

    const patchRequest = new NextRequest(`http://localhost/api/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 1.5, y: 1.5 }),
    });
    const patchResponse = await fieldRoute.PATCH(patchRequest, {
      params: Promise.resolve({ id: field.id }),
    });
    const updated = await patchResponse.json();
    expect(updated.x + updated.width).toBeLessThanOrEqual(1);
    expect(updated.y + updated.height).toBeLessThanOrEqual(1);
  });

  it('deletes a field', async () => {
    const template = await createTemplate();
    const createRequest = new NextRequest('http://localhost/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'template',
        ownerId: template.id,
        type: 'CHECKBOX',
        page: 1,
        x: 0.1,
        y: 0.1,
      }),
    });
    const field = await (await fieldsRoute.POST(createRequest)).json();

    const deleteRequest = new NextRequest(`http://localhost/api/fields/${field.id}`, {
      method: 'DELETE',
    });
    await fieldRoute.DELETE(deleteRequest, { params: Promise.resolve({ id: field.id }) });
    expect(await prisma.field.count()).toBe(0);
  });

  it('lists fields for an owner via GET', async () => {
    const template = await createTemplate();
    await fieldsRoute.POST(
      new NextRequest('http://localhost/api/fields', {
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
      })
    );
    const listRequest = new NextRequest(
      `http://localhost/api/fields?ownerType=template&ownerId=${template.id}`
    );
    const list = await (await fieldsRoute.GET(listRequest)).json();
    expect(list).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/fields-api.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write `src/app/api/fields/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import type { FieldType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clampFieldRect } from '@/lib/fields/clamp';
import { DEFAULT_FIELD_SIZE } from '@/lib/fields/field-defaults';

const VALID_TYPES: FieldType[] = ['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT', 'CHECKBOX'];

export async function GET(request: NextRequest) {
  const ownerType = request.nextUrl.searchParams.get('ownerType');
  const ownerId = request.nextUrl.searchParams.get('ownerId');
  if ((ownerType !== 'template' && ownerType !== 'document') || !ownerId) {
    return NextResponse.json(
      { error: 'ownerType and ownerId query params are required' },
      { status: 400 }
    );
  }
  const fields = await prisma.field.findMany({
    where: ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId },
    orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json(fields);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ownerType = body.ownerType;
  const ownerId = typeof body.ownerId === 'string' ? body.ownerId : '';
  if (ownerType !== 'template' && ownerType !== 'document') {
    return NextResponse.json(
      { error: 'ownerType must be "template" or "document"' },
      { status: 400 }
    );
  }
  if (!ownerId) {
    return NextResponse.json({ error: 'ownerId is required' }, { status: 400 });
  }
  if (typeof body.type !== 'string' || !VALID_TYPES.includes(body.type as FieldType)) {
    return NextResponse.json({ error: 'Invalid field type' }, { status: 400 });
  }
  const type = body.type as FieldType;
  const page = Number.isInteger(body.page) && body.page >= 1 ? body.page : null;
  if (page === null) {
    return NextResponse.json({ error: 'page must be a positive integer' }, { status: 400 });
  }

  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }

  const ownerWhere = ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId };

  let signerRoleId = typeof body.signerRoleId === 'string' ? body.signerRoleId : null;
  if (signerRoleId) {
    const role = await prisma.signerRole.findFirst({ where: { id: signerRoleId, ...ownerWhere } });
    if (!role) {
      return NextResponse.json(
        { error: 'signerRoleId does not belong to this owner' },
        { status: 400 }
      );
    }
  } else {
    const existingRole = await prisma.signerRole.findFirst({
      where: ownerWhere,
      orderBy: { order: 'asc' },
    });
    if (existingRole) {
      signerRoleId = existingRole.id;
    } else {
      const created = await prisma.signerRole.create({
        data: {
          templateId: ownerType === 'template' ? ownerId : null,
          documentId: ownerType === 'document' ? ownerId : null,
          name: 'Signer 1',
          order: 0,
          colorIndex: 0,
        },
      });
      signerRoleId = created.id;
    }
  }

  const defaultSize = DEFAULT_FIELD_SIZE[type];
  const rawX = typeof body.x === 'number' ? body.x : 0.1;
  const rawY = typeof body.y === 'number' ? body.y : 0.1;
  const clamped = clampFieldRect({
    x: rawX,
    y: rawY,
    width: defaultSize.width,
    height: defaultSize.height,
  });

  const field = await prisma.field.create({
    data: {
      templateId: ownerType === 'template' ? ownerId : null,
      documentId: ownerType === 'document' ? ownerId : null,
      signerRoleId,
      type,
      page,
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height,
      required: true,
    },
  });

  return NextResponse.json(field, { status: 201 });
}
```

- [ ] **Step 4: Write `src/app/api/fields/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { clampFieldRect } from '@/lib/fields/clamp';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  const data: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    signerRoleId?: string;
    required?: boolean;
    label?: string | null;
  } = {};

  const hasRectUpdate =
    typeof body.x === 'number' ||
    typeof body.y === 'number' ||
    typeof body.width === 'number' ||
    typeof body.height === 'number';

  if (hasRectUpdate) {
    const clamped = clampFieldRect({
      x: typeof body.x === 'number' ? body.x : existing.x,
      y: typeof body.y === 'number' ? body.y : existing.y,
      width: typeof body.width === 'number' ? body.width : existing.width,
      height: typeof body.height === 'number' ? body.height : existing.height,
    });
    data.x = clamped.x;
    data.y = clamped.y;
    data.width = clamped.width;
    data.height = clamped.height;
  }

  if (typeof body.signerRoleId === 'string') {
    const ownerWhere = existing.templateId
      ? { templateId: existing.templateId }
      : { documentId: existing.documentId };
    const role = await prisma.signerRole.findFirst({
      where: { id: body.signerRoleId, ...ownerWhere },
    });
    if (!role) {
      return NextResponse.json(
        { error: "signerRoleId does not belong to this field's owner" },
        { status: 400 }
      );
    }
    data.signerRoleId = body.signerRoleId;
  }

  if (typeof body.required === 'boolean') {
    data.required = body.required;
  }

  if ('label' in body) {
    data.label = typeof body.label === 'string' ? body.label : null;
  }

  const updated = await prisma.field.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  await prisma.field.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/fields-api.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/fields tests/integration/fields-api.test.ts
git commit -m "Add fields API: create with clamping and role auto-assignment, update, delete"
```

---

### Task 6: Use-template API

**Files:**
- Create: `src/app/api/templates/[id]/use/route.ts`
- Test: `tests/integration/use-template.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `POST /api/templates/:id/use` — consumed by Task 7 (templates UI).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/use-template.test.ts
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as useRoute from '@/app/api/templates/[id]/use/route';
import * as fieldRoute from '@/app/api/fields/[id]/route';

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

describe('use-template API', () => {
  it('rejects using a template with no signer roles', async () => {
    const template = await prisma.template.create({
      data: {
        title: 'Empty',
        originalFilename: 'e.pdf',
        fileHash: 'h1',
        storageKey: 'h1.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
      },
    });
    const request = new NextRequest(`http://localhost/api/templates/${template.id}/use`, {
      method: 'POST',
    });
    const response = await useRoute.POST(request, { params: Promise.resolve({ id: template.id }) });
    expect(response.status).toBe(400);
  });

  it('creates an independent document with duplicated roles and fields', async () => {
    const template = await prisma.template.create({
      data: {
        title: 'NDA',
        originalFilename: 'nda.pdf',
        fileHash: 'h2',
        storageKey: 'h2.pdf',
        pageCount: 2,
        fileSizeBytes: 20,
      },
    });
    const role = await prisma.signerRole.create({
      data: { templateId: template.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const field = await prisma.field.create({
      data: {
        templateId: template.id,
        signerRoleId: role.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.25,
        height: 0.06,
      },
    });

    const request = new NextRequest(`http://localhost/api/templates/${template.id}/use`, {
      method: 'POST',
    });
    const response = await useRoute.POST(request, { params: Promise.resolve({ id: template.id }) });
    const document = await response.json();
    expect(response.status).toBe(201);
    expect(document.storageKey).toBe(template.storageKey);

    const docRoles = await prisma.signerRole.findMany({ where: { documentId: document.id } });
    const docFields = await prisma.field.findMany({ where: { documentId: document.id } });
    expect(docRoles).toHaveLength(1);
    expect(docFields).toHaveLength(1);
    expect(docFields[0].id).not.toBe(field.id);
    expect(docRoles[0].id).not.toBe(role.id);

    // Mutating the document's field must not affect the template's field.
    const patchRequest = new NextRequest(`http://localhost/api/fields/${docFields[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 0.5 }),
    });
    await fieldRoute.PATCH(patchRequest, { params: Promise.resolve({ id: docFields[0].id }) });

    const originalField = await prisma.field.findUnique({ where: { id: field.id } });
    expect(originalField?.x).toBeCloseTo(0.1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/use-template.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write `src/app/api/templates/[id]/use/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    include: { signerRoles: true, fields: true },
  });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  if (template.signerRoles.length === 0) {
    return NextResponse.json(
      {
        error:
          'This template has no signer roles yet — add at least one field before using it',
      },
      { status: 400 }
    );
  }

  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        title: template.title,
        folderId: null,
        originalFilename: template.originalFilename,
        fileHash: template.fileHash,
        storageKey: template.storageKey,
        thumbnailKey: template.thumbnailKey,
        pageCount: template.pageCount,
        fileSizeBytes: template.fileSizeBytes,
        status: 'DRAFT',
      },
    });

    const roleIdMap = new Map<string, string>();
    for (const role of template.signerRoles) {
      const newRole = await tx.signerRole.create({
        data: {
          documentId: doc.id,
          name: role.name,
          order: role.order,
          colorIndex: role.colorIndex,
        },
      });
      roleIdMap.set(role.id, newRole.id);
    }

    for (const field of template.fields) {
      const newSignerRoleId = roleIdMap.get(field.signerRoleId);
      if (!newSignerRoleId) continue;
      await tx.field.create({
        data: {
          documentId: doc.id,
          signerRoleId: newSignerRoleId,
          type: field.type,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          required: field.required,
          label: field.label,
        },
      });
    }

    return doc;
  });

  return NextResponse.json(document, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/use-template.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full test suite**

Run: `npm run test`
Expected: all tests across every task (Phase 1 + Phase 2 so far) pass together.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/templates/[id]/use tests/integration/use-template.test.ts
git commit -m "Add use-template API: instantiate a Document with duplicated roles and fields"
```

---

### Task 7: App-wide navigation (Documents / Templates)

**Files:**
- Create: `src/components/app-nav.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/dashboard/dashboard-client.tsx`
- Modify: `src/components/pdf-viewer.tsx`

**Interfaces:**
- Produces: `<AppNav>` — consumed by `layout.tsx`, wrapping every route. Establishes the `flex-1 overflow-hidden` content area every full-height page (dashboard, viewer, and Task 10's field editor) renders inside, replacing the old assumption that a page owns the full `100vh` directly under `<body>`.

- [ ] **Step 1: Write `src/components/app-nav.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Documents' },
  { href: '/templates', label: 'Templates' },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b px-4">
      <span className="mr-4 font-semibold">eSign</span>
      {LINKS.map((link) => {
        const active = pathname?.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded px-3 py-1.5 text-sm ${
              active ? 'bg-neutral-100 font-medium' : 'text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Modify `src/app/layout.tsx`** to render `<AppNav>` above a flexed content area

Replace the file's contents with:

```tsx
import type { Metadata } from 'next';
import './globals.css';
import { AppNav } from '@/components/app-nav';

export const metadata: Metadata = {
  title: 'eSign',
  description: 'Local electronic signature platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex h-screen flex-col">
          <AppNav />
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Modify `src/app/dashboard/dashboard-client.tsx`** so it fills its new parent instead of the full viewport

Find the outer element:

```tsx
    <div className="flex h-screen">
```

Replace with:

```tsx
    <div className="flex h-full">
```

- [ ] **Step 4: Modify `src/components/pdf-viewer.tsx`** the same way

Find:

```tsx
    <div className="flex h-screen flex-col">
```

Replace with:

```tsx
    <div className="flex h-full flex-col">
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — must be clean.
Run: `./scripts/setup-db.sh && npm run db:generate` then start `npm run dev` in the background, `curl -sI http://localhost:3000/dashboard` (expect 200) and `curl -s http://localhost:3000/dashboard | grep -o 'Documents'` (expect a match — confirms the nav renders). Stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-nav.tsx src/app/layout.tsx src/app/dashboard/dashboard-client.tsx src/components/pdf-viewer.tsx
git commit -m "Add app-wide Documents/Templates navigation"
```

---

### Task 8: Templates library UI

**Files:**
- Create: `src/app/templates/page.tsx`
- Create: `src/app/templates/templates-client.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/templates`, `PATCH/DELETE /api/templates/:id`, `GET /api/templates/:id/thumbnail`, `POST /api/templates/:id/use` (Tasks 3, 6). Renders inside the `flex-1 overflow-hidden` area from Task 7.

- [ ] **Step 1: Write `src/app/templates/templates-client.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface TemplateSummary {
  id: string;
  title: string;
  pageCount: number;
  thumbnailKey: string | null;
  updatedAt: string;
  _count: { signerRoles: number };
}

export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    const response = await fetch('/api/templates');
    if (!response.ok) {
      console.error('Failed to load templates', await response.text());
      return;
    }
    setTemplates(await response.json());
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  async function uploadFiles(files: FileList | File[]) {
    const nextErrors: string[] = [];
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/templates', { method: 'POST', body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Upload failed' }));
        nextErrors.push(`${file.name}: ${body.error ?? 'Upload failed'}`);
      }
    }
    setErrors(nextErrors);
    loadTemplates();
  }

  async function renameTemplate(id: string, currentTitle: string) {
    const title = window.prompt('Rename template', currentTitle);
    if (!title || title === currentTitle) return;
    const response = await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Rename failed' }));
      window.alert(body.error ?? 'Rename failed');
      return;
    }
    loadTemplates();
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Delete failed' }));
      window.alert(body.error ?? 'Delete failed');
      return;
    }
    loadTemplates();
  }

  async function useTemplate(id: string) {
    const response = await fetch(`/api/templates/${id}/use`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to use template' }));
      window.alert(body.error ?? 'Failed to use template');
      return;
    }
    const document = await response.json();
    window.location.href = `/documents/${document.id}/edit`;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Templates</h1>
        <div>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
            onClick={() => inputRef.current?.click()}
          >
            + New Template
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                uploadFiles(event.target.files);
                event.target.value = '';
              }
            }}
          />
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="mb-4 space-y-1 text-sm text-red-600">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {templates.length === 0 && (
        <p className="py-12 text-center text-sm text-neutral-400">No templates yet.</p>
      )}
      <div className="grid grid-cols-4 gap-4">
        {templates.map((template) => (
          <div key={template.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <Link href={`/templates/${template.id}/edit`}>
              <img
                src={
                  template.thumbnailKey
                    ? `/api/templates/${template.id}/thumbnail`
                    : '/pdf-placeholder.svg'
                }
                alt=""
                className="h-32 w-full rounded border object-contain"
              />
            </Link>
            <p className="truncate font-medium">{template.title}</p>
            <p className="text-xs text-neutral-500">
              {template.pageCount} page{template.pageCount === 1 ? '' : 's'} ·{' '}
              {template._count.signerRoles} signer{template._count.signerRoles === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2 text-xs">
              <button className="underline" onClick={() => useTemplate(template.id)}>
                Use
              </button>
              <button className="underline" onClick={() => renameTemplate(template.id, template.title)}>
                Rename
              </button>
              <button className="text-red-600 underline" onClick={() => deleteTemplate(template.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/templates/page.tsx`**

```tsx
import { TemplatesClient } from './templates-client';

export default function TemplatesPage() {
  return <TemplatesClient />;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/templates
git commit -m "Add templates library UI: upload, grid, rename, delete, use"
```

---

### Task 9: Field editor — shared types and FieldPalette

**Files:**
- Create: `src/components/field-editor/types.ts`
- Create: `src/components/field-editor/field-palette.tsx`

**Interfaces:**
- Consumes: `FIELD_TYPE_LABELS`, `ROLE_COLORS` (`@/lib/fields/field-defaults`, Task 2).
- Produces: `FieldOwnerType`, `SignerRoleRecord`, `FieldTypeValue`, `FieldRecord` types; `<FieldPalette>` — consumed by Task 10.

- [ ] **Step 1: Write `src/components/field-editor/types.ts`**

```ts
export type FieldOwnerType = 'template' | 'document';

export interface SignerRoleRecord {
  id: string;
  name: string;
  order: number;
  colorIndex: number;
}

export type FieldTypeValue = 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'TEXT' | 'CHECKBOX';

export interface FieldRecord {
  id: string;
  signerRoleId: string;
  type: FieldTypeValue;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
}
```

- [ ] **Step 2: Write `src/components/field-editor/field-palette.tsx`**

```tsx
'use client';

import { FIELD_TYPE_LABELS, ROLE_COLORS } from '@/lib/fields/field-defaults';
import type { FieldTypeValue, SignerRoleRecord } from './types';

const FIELD_TYPES: FieldTypeValue[] = ['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT', 'CHECKBOX'];

interface FieldPaletteProps {
  roles: SignerRoleRecord[];
  selectedRoleId: string | null;
  onSelectRole: (roleId: string) => void;
  onAddRole: () => void;
  onDragFieldType: (type: FieldTypeValue, event: React.DragEvent) => void;
}

export function FieldPalette({
  roles,
  selectedRoleId,
  onSelectRole,
  onAddRole,
  onDragFieldType,
}: FieldPaletteProps) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r p-4">
      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Fields</h2>
        <div className="flex flex-col gap-1">
          {FIELD_TYPES.map((type) => (
            <div
              key={type}
              draggable
              onDragStart={(event) => onDragFieldType(type, event)}
              className="cursor-grab rounded border px-3 py-2 text-sm hover:bg-neutral-50"
            >
              {FIELD_TYPE_LABELS[type]}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Signers</h2>
        <div className="flex flex-col gap-1">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => onSelectRole(role.id)}
              className={`flex items-center gap-2 rounded px-3 py-2 text-left text-sm ${
                selectedRoleId === role.id ? 'bg-neutral-100 font-medium' : 'hover:bg-neutral-50'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: ROLE_COLORS[role.colorIndex % ROLE_COLORS.length] }}
              />
              {role.name}
            </button>
          ))}
          <button
            onClick={onAddRole}
            className="rounded px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-50"
          >
            + Add signer role
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/field-editor/types.ts src/components/field-editor/field-palette.tsx
git commit -m "Add field editor shared types and field/role palette"
```

---

### Task 10: Field editor — FieldBox (drag, resize, select, inline toolbar)

**Files:**
- Create: `src/components/field-editor/field-box.tsx`

**Interfaces:**
- Consumes: `FieldRecord`, `SignerRoleRecord` (`./types`, Task 9), `FIELD_TYPE_LABELS`, `ROLE_COLORS` (`@/lib/fields/field-defaults`).
- Produces: `<FieldBox>` — consumed by Task 11.

- [ ] **Step 1: Write `src/components/field-editor/field-box.tsx`**

```tsx
'use client';

import { useRef } from 'react';
import { FIELD_TYPE_LABELS, ROLE_COLORS } from '@/lib/fields/field-defaults';
import type { FieldRecord, SignerRoleRecord } from './types';

interface FieldBoxProps {
  field: FieldRecord;
  role: SignerRoleRecord | undefined;
  roles: SignerRoleRecord[];
  isSelected: boolean;
  onSelect: () => void;
  onMove: (nextX: number, nextY: number) => void;
  onResize: (nextWidth: number, nextHeight: number) => void;
  onReassignRole: (roleId: string) => void;
  onToggleRequired: () => void;
  onDelete: () => void;
}

export function FieldBox({
  field,
  role,
  roles,
  isSelected,
  onSelect,
  onMove,
  onResize,
  onReassignRole,
  onToggleRequired,
  onDelete,
}: FieldBoxProps) {
  const dragState = useRef<{ startX: number; startY: number; fieldX: number; fieldY: number } | null>(
    null
  );
  const resizeState = useRef<{ startX: number; startY: number; width: number; height: number } | null>(
    null
  );

  function handleDragMouseDown(event: React.MouseEvent) {
    event.stopPropagation();
    onSelect();
    const container = (event.currentTarget as HTMLElement).closest('[data-page-surface]');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      fieldX: field.x,
      fieldY: field.y,
    };

    function handleMouseMove(moveEvent: MouseEvent) {
      if (!dragState.current) return;
      const deltaX = (moveEvent.clientX - dragState.current.startX) / rect.width;
      const deltaY = (moveEvent.clientY - dragState.current.startY) / rect.height;
      onMove(dragState.current.fieldX + deltaX, dragState.current.fieldY + deltaY);
    }

    function handleMouseUp() {
      dragState.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleResizeMouseDown(event: React.MouseEvent) {
    event.stopPropagation();
    const container = (event.currentTarget as HTMLElement).closest('[data-page-surface]');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    resizeState.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: field.width,
      height: field.height,
    };

    function handleMouseMove(moveEvent: MouseEvent) {
      if (!resizeState.current) return;
      const deltaWidth = (moveEvent.clientX - resizeState.current.startX) / rect.width;
      const deltaHeight = (moveEvent.clientY - resizeState.current.startY) / rect.height;
      onResize(resizeState.current.width + deltaWidth, resizeState.current.height + deltaHeight);
    }

    function handleMouseUp() {
      resizeState.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  const color = role ? ROLE_COLORS[role.colorIndex % ROLE_COLORS.length] : '#999999';

  return (
    <div
      onMouseDown={handleDragMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="absolute flex cursor-move items-center justify-center overflow-hidden rounded border-2 text-[10px] font-medium"
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
        borderColor: color,
        backgroundColor: `${color}22`,
        color,
      }}
    >
      {FIELD_TYPE_LABELS[field.type]}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
        style={{ backgroundColor: color }}
      />
      {isSelected && (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="absolute -top-9 left-0 flex items-center gap-2 rounded border bg-white px-2 py-1 text-neutral-800 shadow"
        >
          <select
            value={field.signerRoleId}
            onChange={(event) => onReassignRole(event.target.value)}
            className="text-xs"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={field.required} onChange={onToggleRequired} />
            Required
          </label>
          <button onClick={onDelete} className="text-xs text-red-600">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/field-editor/field-box.tsx
git commit -m "Add FieldBox: draggable, resizable, selectable field overlay"
```

---

### Task 11: Field editor orchestrator, edit routes, dashboard entry point

**Files:**
- Create: `src/components/field-editor/field-editor.tsx`
- Create: `src/app/templates/[id]/edit/page.tsx`
- Create: `src/app/documents/[id]/edit/page.tsx`
- Modify: `src/components/document-grid.tsx`

**Interfaces:**
- Consumes: `<FieldPalette>` (Task 9), `<FieldBox>` (Task 10), `GET/POST /api/signer-roles`, `GET/POST /api/fields`, `PATCH/DELETE /api/fields/:id` (Tasks 4, 5), `prisma` (Task 8 of Phase 1).
- Produces: `<FieldEditor ownerType ownerId title fileUrl />`, routes `/templates/:id/edit` and `/documents/:id/edit`.

- [ ] **Step 1: Write `src/components/field-editor/field-editor.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FieldPalette } from './field-palette';
import { FieldBox } from './field-box';
import type { FieldOwnerType, FieldRecord, FieldTypeValue, SignerRoleRecord } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface FieldEditorProps {
  ownerType: FieldOwnerType;
  ownerId: string;
  title: string;
  fileUrl: string;
}

export function FieldEditor({ ownerType, ownerId, title, fileUrl }: FieldEditorProps) {
  const [roles, setRoles] = useState<SignerRoleRecord[]>([]);
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const pageRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  const query = `ownerType=${ownerType}&ownerId=${ownerId}`;

  const loadRoles = useCallback(async () => {
    const response = await fetch(`/api/signer-roles?${query}`);
    if (!response.ok) return;
    const data: SignerRoleRecord[] = await response.json();
    setRoles(data);
    setSelectedRoleId((current) => current ?? (data.length > 0 ? data[0].id : null));
  }, [query]);

  const loadFields = useCallback(async () => {
    const response = await fetch(`/api/fields?${query}`);
    if (!response.ok) return;
    setFields(await response.json());
  }, [query]);

  useEffect(() => {
    loadRoles();
    loadFields();
  }, [loadRoles, loadFields]);

  useEffect(() => {
    let cancelled = false;
    pdfjsLib.getDocument(fileUrl).promise.then((doc) => {
      if (cancelled) return;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
    });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

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

  async function addRole() {
    const response = await fetch('/api/signer-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to add signer role' }));
      window.alert(body.error ?? 'Failed to add signer role');
      return;
    }
    const role = await response.json();
    setSelectedRoleId(role.id);
    loadRoles();
  }

  async function createField(type: FieldTypeValue, page: number, x: number, y: number) {
    const response = await fetch('/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, type, page, x, y, signerRoleId: selectedRoleId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to create field' }));
      window.alert(body.error ?? 'Failed to create field');
      return;
    }
    loadFields();
    loadRoles();
  }

  async function patchField(id: string, data: Record<string, unknown>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...data } : f)));
    const response = await fetch(`/api/fields/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to update field' }));
      window.alert(body.error ?? 'Failed to update field');
      loadFields();
    }
  }

  async function deleteField(id: string) {
    const response = await fetch(`/api/fields/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to delete field' }));
      window.alert(body.error ?? 'Failed to delete field');
      return;
    }
    setSelectedFieldId(null);
    loadFields();
  }

  function handleDropOnPage(page: number, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-esign-field-type') as FieldTypeValue;
    if (!type) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    createField(type, page, x, y);
  }

  return (
    <div className="flex h-full">
      <FieldPalette
        roles={roles}
        selectedRoleId={selectedRoleId}
        onSelectRole={setSelectedRoleId}
        onAddRole={addRole}
        onDragFieldType={(type, event) =>
          event.dataTransfer.setData('application/x-esign-field-type', type)
        }
      />
      <div
        className="flex-1 overflow-y-auto bg-neutral-100 p-6"
        onClick={() => setSelectedFieldId(null)}
      >
        <h1 className="mb-4 font-medium">{title}</h1>
        <div className="flex flex-col items-center gap-6">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
            <div
              key={page}
              data-page-surface
              className="relative shadow"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDropOnPage(page, event)}
            >
              <canvas
                ref={(el) => {
                  pageRefs.current[page] = el;
                }}
              />
              {fields
                .filter((f) => f.page === page)
                .map((field) => (
                  <FieldBox
                    key={field.id}
                    field={field}
                    role={roles.find((r) => r.id === field.signerRoleId)}
                    roles={roles}
                    isSelected={selectedFieldId === field.id}
                    onSelect={() => setSelectedFieldId(field.id)}
                    onMove={(x, y) => patchField(field.id, { x, y })}
                    onResize={(width, height) => patchField(field.id, { width, height })}
                    onReassignRole={(roleId) => patchField(field.id, { signerRoleId: roleId })}
                    onToggleRequired={() => patchField(field.id, { required: !field.required })}
                    onDelete={() => deleteField(field.id)}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/templates/[id]/edit/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { FieldEditor } from '@/components/field-editor/field-editor';

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) notFound();
  return (
    <FieldEditor
      ownerType="template"
      ownerId={template.id}
      title={template.title}
      fileUrl={`/api/templates/${template.id}/file`}
    />
  );
}
```

- [ ] **Step 3: Write `src/app/documents/[id]/edit/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { FieldEditor } from '@/components/field-editor/field-editor';

export default async function DocumentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) notFound();
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

- [ ] **Step 4: Modify `src/components/document-grid.tsx`** to add an "Edit fields" entry point for Draft documents

The card's outer element is currently a `<Link>` (an anchor) directly wrapping the thumbnail and title/status block, with `draggable`/`onDragStart` on that same anchor. Replace the entire `.map((doc) => (...))` block (currently spanning from `<Link key={doc.id}` through its closing `</Link>`) with:

```tsx
        {sorted.map((doc) => (
          <div
            key={doc.id}
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData('application/x-esign-document-id', doc.id)
            }
            className={
              view === 'grid'
                ? 'flex flex-col gap-2 rounded-lg border p-3 hover:border-neutral-400'
                : 'flex items-center gap-3 py-2 hover:bg-neutral-50'
            }
          >
            <Link href={`/documents/${doc.id}`} className="contents">
              <img
                src={doc.thumbnailKey ? `/api/documents/${doc.id}/thumbnail` : '/pdf-placeholder.svg'}
                alt=""
                className={
                  view === 'grid'
                    ? 'h-32 w-full rounded border object-cover'
                    : 'h-10 w-8 rounded border object-cover'
                }
              />
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
        ))}
```

(The `contents` Tailwind class makes the inner `<Link>` render its children without its own box, preserving the exact visual layout while keeping it a sibling — not a parent — of the "Edit fields" link, so there's no invalid anchor-inside-anchor nesting.)

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit` — must be clean.

- [ ] **Step 6: Manual verification**

Run: `./scripts/setup-db.sh && npm run db:generate && npm run dev`
Open `http://localhost:3000/templates`, upload a real multi-page PDF, click it to open the editor, drag a Signature field onto the page, confirm it appears and persists after a page reload. Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add src/components/field-editor/field-editor.tsx src/app/templates/[id]/edit src/app/documents/[id]/edit src/components/document-grid.tsx
git commit -m "Add field editor orchestrator, edit routes, and dashboard entry point"
```

---

### Task 12: Manual end-to-end browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

Run: `./scripts/setup-db.sh && npm run db:generate && npm run dev`
Open `http://localhost:3000`.

- [ ] **Step 2: Create a template and place fields**

Go to Templates → upload a real multi-page PDF. Open its editor. Drag a Signature field onto page 1, an Initials field onto page 2. Confirm both appear color-coded to "Signer 1" and persist across a page reload.

- [ ] **Step 3: Add a second signer role**

Click "+ Add signer role" — confirm "Signer 2" appears with a distinct color. Select it, drag a Text field onto the page — confirm it's colored differently from the Signer-1 fields.

- [ ] **Step 4: Resize and reassign**

Drag a field's corner handle to resize it — confirm the new size persists after reload. Click a field, reassign its role via the inline dropdown — confirm its color updates immediately.

- [ ] **Step 5: Delete a signer role with fields assigned**

Delete "Signer 1" (which still has fields assigned to it). Confirm the fields previously on Signer 1 are now shown under Signer 2's color instead of disappearing or erroring.

- [ ] **Step 6: Use the template**

Click "Use" on the template card. Confirm it redirects to a new document's field editor, showing the same fields/roles as the template, and that the template itself (revisit `/templates/:id/edit`) still has its own unchanged fields.

- [ ] **Step 7: Edit fields on the new document independently**

Move a field on the new document. Confirm the template's corresponding field is unaffected.

- [ ] **Step 8: Verify the dashboard entry point**

Go to Documents, confirm the newly created (Draft) document shows an "Edit fields" link, and that clicking it opens the same editor.

- [ ] **Step 9: Record results**

If every step above matches its expected result, Phase 2 is complete. If any step fails, note it before starting Phase 3.

