# Phase 1: Documents, Folders & PDF Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of a locally-hosted e-signature platform: upload PDFs, organize them into nested folders, and view them in-browser — with every document SHA-256 hashed on ingest and all files stored behind a swappable storage interface.

**Architecture:** A single Next.js 15 (App Router, TypeScript) app running on localhost via `npm run dev`, opening straight into `/dashboard`. Prisma ORM against a local PostgreSQL database holds metadata; a `StorageAdapter` interface (local-filesystem implementation, rooted outside the git repo) holds PDF bytes and thumbnails. `pdfjs-dist` renders pages both server-side (thumbnails, via `@napi-rs/canvas`) and client-side (the viewer).

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Prisma 6 + PostgreSQL, `pdfjs-dist` 4, `@napi-rs/canvas`, Vitest, `pdf-lib` (test fixtures only).

## Global Constraints

- No auth, login, signup, passwords, accounts, sessions, orgs, teams, roles, permissions, multi-tenancy, billing, or API keys — this is a single-user localhost app.
- The app launches directly into the dashboard — `/` redirects to `/dashboard`.
- All data is local: PostgreSQL for metadata, local filesystem for files. No cloud services, no network calls except to `localhost`.
- Metadata storage is PostgreSQL only (not SQLite), per spec.
- All file I/O (PDFs, thumbnails) goes through the `StorageAdapter` interface, never direct `fs` calls from route handlers — this is what makes cloud storage addable later without touching business logic.
- No placeholder implementations, no `TODO`s, no mocked features — every task ships a complete, working slice.
- Every document is SHA-256 hashed on ingest (tamper-evidence groundwork for a later phase).
- Git remote is already set: `https://github.com/zachb02/esign.git`. Commit at the end of every task. Do not add a `Co-Authored-By` trailer to commit messages (user's established preference).
- Uploaded files and thumbnails must never be committed to git — they live in `~/Library/Application Support/esign-app/`, entirely outside the repo directory.

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.js`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `.gitignore`
- Create: `.env` (not committed)
- Create: `.env.example`
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

**Interfaces:**
- Produces: `npm run dev`, `npm run build`, `npm run test`, `npm run db:migrate` scripts that every later task relies on. Path alias `@/*` → `./src/*`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "esign-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate"
  },
  "dependencies": {
    "next": "15.1.6",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "@prisma/client": "6.2.1",
    "pdfjs-dist": "4.9.155",
    "@napi-rs/canvas": "0.1.55"
  },
  "devDependencies": {
    "typescript": "5.7.3",
    "@types/node": "22.10.10",
    "@types/react": "19.0.7",
    "@types/react-dom": "19.0.3",
    "prisma": "6.2.1",
    "vitest": "2.1.8",
    "dotenv": "16.4.7",
    "pdf-lib": "1.17.1",
    "tailwindcss": "3.4.17",
    "postcss": "8.5.1",
    "autoprefixer": "10.4.20",
    "eslint": "9.18.0",
    "eslint-config-next": "15.1.6"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.ts`**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Write `tailwind.config.ts` and `postcss.config.js`**

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

```js
// postcss.config.js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Write `vitest.config.ts` and `vitest.setup.ts`**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

```ts
// vitest.setup.ts
import { config } from 'dotenv';

config({ path: '.env.test' });
```

- [ ] **Step 6: Write `.gitignore`, `.env`, `.env.example`**

```
# .gitignore
node_modules/
.next/
.env
.env.test
dist/
*.log
.DS_Store
```

```
# .env  (not committed)
DATABASE_URL="postgresql://localhost:5432/esign_app"
```

```
# .env.example  (committed)
DATABASE_URL="postgresql://localhost:5432/esign_app"
```

- [ ] **Step 7: Write app shell files**

```css
/* src/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

html,
body {
  height: 100%;
}
```

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'eSign',
  description: 'Local electronic signature platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/dashboard');
}
```

- [ ] **Step 8: Install dependencies**

Run: `cd ~/Documents/esign-app && npm install`
Expected: installs without errors, creates `package-lock.json`.

- [ ] **Step 9: Verify the project builds**

Run: `npm run build`
Expected: build succeeds (the `/dashboard` redirect target doesn't need to exist yet — `redirect()` isn't checked at build time).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts tailwind.config.ts postcss.config.js vitest.config.ts vitest.setup.ts .gitignore .env.example src/app/globals.css src/app/layout.tsx src/app/page.tsx
git commit -m "Scaffold Next.js app with Tailwind and Vitest"
```

---

### Task 2: Database schema & local Postgres setup

**Files:**
- Create: `prisma/schema.prisma`
- Create: `scripts/setup-db.sh`
- Modify: `.env.test` (not committed, local only)

**Interfaces:**
- Produces: `Folder` and `Document` Prisma models, `DocumentStatus` enum, generated `@prisma/client` types consumed by every later task that touches the database.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Folder {
  id        String     @id @default(cuid())
  name      String
  parentId  String?
  parent    Folder?    @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children  Folder[]   @relation("FolderTree")
  documents Document[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
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
  folder           Folder?        @relation(fields: [folderId], references: [id], onDelete: SetNull)
  originalFilename String
  fileHash         String
  storageKey       String
  thumbnailKey     String?
  pageCount        Int
  fileSizeBytes    Int
  status           DocumentStatus @default(DRAFT)
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}
```

- [ ] **Step 2: Write `scripts/setup-db.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

createdb esign_app 2>/dev/null || echo "esign_app already exists"
createdb esign_app_test 2>/dev/null || echo "esign_app_test already exists"

echo "Databases ready: esign_app, esign_app_test"
```

- [ ] **Step 3: Make the script executable and run it**

Run: `chmod +x scripts/setup-db.sh && ./scripts/setup-db.sh`
Expected: prints that both `esign_app` and `esign_app_test` are ready. If this fails with "could not connect", start Postgres first: `brew services start postgresql@14` (or whichever version is installed — check with `brew list | grep postgresql`).

- [ ] **Step 4: Write `.env.test` (not committed)**

```
DATABASE_URL="postgresql://localhost:5432/esign_app_test"
```

- [ ] **Step 5: Generate and run the initial migration against the dev database**

Run: `npx prisma migrate dev --name init`
Expected: creates `prisma/migrations/<timestamp>_init/migration.sql`, applies it to `esign_app`, regenerates the Prisma client.

- [ ] **Step 6: Apply the same migration to the test database**

Run: `DATABASE_URL="postgresql://localhost:5432/esign_app_test" npx prisma migrate deploy`
Expected: applies the existing migration to `esign_app_test` without prompting to create a new one.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations scripts/setup-db.sh
git commit -m "Add Prisma schema for Folder/Document and local Postgres setup script"
```

---

### Task 3: App data paths module

**Files:**
- Create: `src/lib/paths.ts`
- Test: `src/lib/paths.test.ts`

**Interfaces:**
- Produces: `getAppDataDir(): string`, `getDocumentsDir(): string`, `getThumbnailsDir(): string` — consumed by Task 4 (storage adapter singletons).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/paths.test.ts
import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { getAppDataDir, getDocumentsDir, getThumbnailsDir } from './paths';

describe('paths', () => {
  afterEach(() => {
    delete process.env.ESIGN_DATA_DIR;
  });

  it('defaults to the macOS Application Support directory', () => {
    expect(getAppDataDir()).toBe(
      path.join(os.homedir(), 'Library', 'Application Support', 'esign-app')
    );
  });

  it('respects an ESIGN_DATA_DIR override', () => {
    process.env.ESIGN_DATA_DIR = '/tmp/esign-test-override';
    expect(getAppDataDir()).toBe('/tmp/esign-test-override');
  });

  it('nests documents and thumbnails under the app data dir', () => {
    process.env.ESIGN_DATA_DIR = '/tmp/esign-test-override';
    expect(getDocumentsDir()).toBe('/tmp/esign-test-override/documents');
    expect(getThumbnailsDir()).toBe('/tmp/esign-test-override/thumbnails');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/paths.test.ts`
Expected: FAIL — `./paths` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/paths.ts
import os from 'node:os';
import path from 'node:path';

export function getAppDataDir(): string {
  const override = process.env.ESIGN_DATA_DIR;
  if (override) return override;
  return path.join(os.homedir(), 'Library', 'Application Support', 'esign-app');
}

export function getDocumentsDir(): string {
  return path.join(getAppDataDir(), 'documents');
}

export function getThumbnailsDir(): string {
  return path.join(getAppDataDir(), 'thumbnails');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/paths.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/paths.ts src/lib/paths.test.ts
git commit -m "Add app data directory resolver"
```

---

### Task 4: Storage adapter (interface + local filesystem implementation)

**Files:**
- Create: `src/lib/storage/storage-adapter.ts`
- Create: `src/lib/storage/local-fs-storage-adapter.ts`
- Create: `src/lib/storage/index.ts`
- Test: `src/lib/storage/local-fs-storage-adapter.test.ts`

**Interfaces:**
- Produces: `StorageAdapter` interface (`save`, `read`, `delete`, `exists`), `LocalFsStorageAdapter` class, `getDocumentStorage(): StorageAdapter`, `getThumbnailStorage(): StorageAdapter` — consumed by Task 7 (thumbnail render) and Task 10 (documents API).
- Consumes: `getDocumentsDir`, `getThumbnailsDir` from Task 3 (`@/lib/paths`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/storage/local-fs-storage-adapter.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalFsStorageAdapter } from './local-fs-storage-adapter';

describe('LocalFsStorageAdapter', () => {
  let root: string;
  let adapter: LocalFsStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'esign-storage-'));
    adapter = new LocalFsStorageAdapter(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a small file', async () => {
    await adapter.save('a.txt', Buffer.from('hello'));
    expect(await adapter.exists('a.txt')).toBe(true);
    expect((await adapter.read('a.txt')).toString()).toBe('hello');
  });

  it('round-trips a large file (5MB)', async () => {
    const large = Buffer.alloc(5 * 1024 * 1024, 7);
    await adapter.save('big.bin', large);
    const read = await adapter.read('big.bin');
    expect(read.equals(large)).toBe(true);
  });

  it('creates nested directories for keys with slashes', async () => {
    await adapter.save('sub/dir/file.txt', Buffer.from('x'));
    expect(await adapter.exists('sub/dir/file.txt')).toBe(true);
  });

  it('deletes a file', async () => {
    await adapter.save('gone.txt', Buffer.from('x'));
    await adapter.delete('gone.txt');
    expect(await adapter.exists('gone.txt')).toBe(false);
  });

  it('reports exists=false for a missing key', async () => {
    expect(await adapter.exists('missing.txt')).toBe(false);
  });

  it('rejects keys that escape the storage root', async () => {
    await expect(adapter.save('../escape.txt', Buffer.from('x'))).rejects.toThrow(
      'Invalid storage key'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/storage/local-fs-storage-adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/storage/storage-adapter.ts
export interface StorageAdapter {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

```ts
// src/lib/storage/local-fs-storage-adapter.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StorageAdapter } from './storage-adapter';

export class LocalFsStorageAdapter implements StorageAdapter {
  constructor(private readonly rootDir: string) {}

  private resolveKeyPath(key: string): string {
    const normalized = path.normalize(key);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return path.join(this.rootDir, normalized);
  }

  async save(key: string, data: Buffer): Promise<void> {
    const filePath = this.resolveKeyPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKeyPath(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolveKeyPath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKeyPath(key));
      return true;
    } catch {
      return false;
    }
  }
}
```

```ts
// src/lib/storage/index.ts
import { LocalFsStorageAdapter } from './local-fs-storage-adapter';
import { getDocumentsDir, getThumbnailsDir } from '@/lib/paths';
import type { StorageAdapter } from './storage-adapter';

let documentStorage: StorageAdapter | null = null;
let thumbnailStorage: StorageAdapter | null = null;

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

export type { StorageAdapter } from './storage-adapter';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/storage/local-fs-storage-adapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage
git commit -m "Add StorageAdapter interface and local filesystem implementation"
```

---

### Task 5: PDF validation

**Files:**
- Create: `src/lib/pdf/validate.ts`
- Test: `src/lib/pdf/validate.test.ts`

**Interfaces:**
- Produces: `isPdfBuffer(data: Buffer): boolean`, `assertValidPdf(data: Buffer): void`, `InvalidPdfError` — consumed by Task 10 (upload route).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pdf/validate.test.ts
import { describe, expect, it } from 'vitest';
import { isPdfBuffer, assertValidPdf, InvalidPdfError } from './validate';

describe('PDF validation', () => {
  it('accepts a buffer starting with the PDF magic bytes', () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.7\n...'))).toBe(true);
  });

  it('rejects a buffer without the PDF magic bytes', () => {
    expect(isPdfBuffer(Buffer.from('not a pdf'))).toBe(false);
  });

  it('rejects a buffer shorter than the magic bytes', () => {
    expect(isPdfBuffer(Buffer.from('%PD'))).toBe(false);
  });

  it('assertValidPdf throws InvalidPdfError for a non-PDF buffer', () => {
    expect(() => assertValidPdf(Buffer.from('nope'))).toThrow(InvalidPdfError);
  });

  it('assertValidPdf does not throw for a valid PDF buffer', () => {
    expect(() => assertValidPdf(Buffer.from('%PDF-1.4\n'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pdf/validate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pdf/validate.ts
const PDF_MAGIC = Buffer.from('%PDF-');

export function isPdfBuffer(data: Buffer): boolean {
  if (data.length < PDF_MAGIC.length) return false;
  return data.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

export class InvalidPdfError extends Error {
  constructor(message = 'File is not a valid PDF') {
    super(message);
    this.name = 'InvalidPdfError';
  }
}

export function assertValidPdf(data: Buffer): void {
  if (!isPdfBuffer(data)) {
    throw new InvalidPdfError();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pdf/validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/validate.ts src/lib/pdf/validate.test.ts
git commit -m "Add PDF magic-byte validation"
```

---

### Task 6: SHA-256 hashing utility

**Files:**
- Create: `src/lib/pdf/hash.ts`
- Test: `src/lib/pdf/hash.test.ts`

**Interfaces:**
- Produces: `sha256Hex(data: Buffer): string` — consumed by Task 10 (upload route, as the storage key and tamper-evidence hash).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pdf/hash.test.ts
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('is deterministic for the same input', () => {
    const data = Buffer.from('hello world');
    expect(sha256Hex(data)).toBe(sha256Hex(Buffer.from('hello world')));
  });

  it('differs for different input', () => {
    expect(sha256Hex(Buffer.from('a'))).not.toBe(sha256Hex(Buffer.from('b')));
  });

  it('matches the known SHA-256 of an empty buffer', () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pdf/hash.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pdf/hash.ts
import { createHash } from 'node:crypto';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pdf/hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf/hash.ts src/lib/pdf/hash.test.ts
git commit -m "Add SHA-256 hashing utility"
```

---

### Task 7: PDF page count & thumbnail rendering

**Files:**
- Create: `src/lib/pdf/render.ts`
- Create: `tests/fixtures/make-test-pdf.ts`
- Test: `src/lib/pdf/render.test.ts`

**Interfaces:**
- Produces: `getPdfPageCount(pdfBuffer: Buffer): Promise<number>`, `renderPdfPageToPng(pdfBuffer: Buffer, pageNumber: number): Promise<Buffer>` — consumed by Task 10 (upload route). Also produces `makeTestPdf(pageCount?: number): Promise<Buffer>`, reused by Task 10's and Task 15's tests.

- [ ] **Step 1: Write the test fixture helper**

```ts
// tests/fixtures/make-test-pdf.ts
import { PDFDocument } from 'pdf-lib';

export async function makeTestPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    doc.addPage([200, 200]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/pdf/render.test.ts
import { describe, expect, it } from 'vitest';
import { getPdfPageCount, renderPdfPageToPng } from './render';
import { makeTestPdf } from '../../../tests/fixtures/make-test-pdf';

describe('PDF rendering', () => {
  it('counts pages correctly for a single-page PDF', async () => {
    const pdf = await makeTestPdf(1);
    expect(await getPdfPageCount(pdf)).toBe(1);
  });

  it('counts pages correctly for a multi-page PDF', async () => {
    const pdf = await makeTestPdf(5);
    expect(await getPdfPageCount(pdf)).toBe(5);
  });

  it('renders page 1 to a non-empty PNG buffer', async () => {
    const pdf = await makeTestPdf(2);
    const png = await renderPdfPageToPng(pdf, 1);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/pdf/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/pdf/render.ts
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

interface CanvasAndContext {
  canvas: Canvas;
  context: SKRSContext2D;
}

class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDocument = await loadingTask.promise;
  const count = pdfDocument.numPages;
  await pdfDocument.destroy();
  return count;
}

export async function renderPdfPageToPng(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale = 1.0
): Promise<Buffer> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
  });
  const pdfDocument = await loadingTask.promise;
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvasFactory = new NodeCanvasFactory();
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

  await page.render({
    canvasContext: canvasAndContext.context as unknown as CanvasRenderingContext2D,
    viewport,
    canvasFactory,
  }).promise;

  const buffer = canvasAndContext.canvas.toBuffer('image/png');
  await pdfDocument.destroy();
  return Buffer.from(buffer);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/pdf/render.test.ts`
Expected: PASS (3 tests). If `@napi-rs/canvas` fails to load a prebuilt binary for the current platform/arch, re-run `npm install @napi-rs/canvas` to fetch the correct prebuild — no source compilation should be required on macOS arm64/x64.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf/render.ts src/lib/pdf/render.test.ts tests/fixtures/make-test-pdf.ts
git commit -m "Add PDF page-count and thumbnail rendering"
```

---

### Task 8: Prisma client singleton, folder cycle-guard, folder-tree builder

**Files:**
- Create: `src/lib/db/prisma.ts`
- Create: `src/lib/folders/cycle-guard.ts`
- Create: `src/lib/folders/build-tree.ts`
- Test: `src/lib/folders/cycle-guard.test.ts`
- Test: `src/lib/folders/build-tree.test.ts`

**Interfaces:**
- Produces: `prisma` client instance (`@/lib/db/prisma`), `wouldCreateCycle(folders, folderId, newParentId): boolean`, `buildFolderTree(folders: FolderRecord[]): FolderTreeNode[]` — consumed by Task 9 (folders API) and Task 11 (folder tree UI).

- [ ] **Step 1: Write the Prisma client singleton**

```ts
// src/lib/db/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Write the failing cycle-guard test**

```ts
// src/lib/folders/cycle-guard.test.ts
import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from './cycle-guard';

const folders = [
  { id: 'root', parentId: null },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
  { id: 'sibling', parentId: 'root' },
];

describe('wouldCreateCycle', () => {
  it('is true when moving a folder into itself', () => {
    expect(wouldCreateCycle(folders, 'child', 'child')).toBe(true);
  });

  it('is true when moving a folder into its own descendant', () => {
    expect(wouldCreateCycle(folders, 'root', 'grandchild')).toBe(true);
  });

  it('is false when moving a folder into an unrelated folder', () => {
    expect(wouldCreateCycle(folders, 'child', 'sibling')).toBe(false);
  });

  it('is false when moving a folder to become a root (no cycle possible)', () => {
    expect(wouldCreateCycle(folders, 'grandchild', 'sibling')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/folders/cycle-guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the cycle-guard implementation**

```ts
// src/lib/folders/cycle-guard.ts
export interface FolderNode {
  id: string;
  parentId: string | null;
}

export function wouldCreateCycle(
  folders: FolderNode[],
  folderId: string,
  newParentId: string
): boolean {
  if (folderId === newParentId) return true;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(newParentId);
  while (current) {
    if (current.id === folderId) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/folders/cycle-guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing build-tree test**

```ts
// src/lib/folders/build-tree.test.ts
import { describe, expect, it } from 'vitest';
import { buildFolderTree } from './build-tree';

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const tree = buildFolderTree([
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
    expect(tree[0].children[0].id).toBe('b');
    expect(tree[0].children[0].children[0].id).toBe('c');
  });

  it('treats a folder with a missing parentId as a root', () => {
    const tree = buildFolderTree([
      { id: 'a', name: 'A', parentId: null },
      { id: 'orphan', name: 'Orphan', parentId: 'does-not-exist' },
    ]);
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'orphan']);
  });

  it('returns an empty array for no folders', () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/lib/folders/build-tree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Write the build-tree implementation**

```ts
// src/lib/folders/build-tree.ts
export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FolderTreeNode extends FolderRecord {
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: FolderRecord[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>(
    folders.map((f) => [f.id, { ...f, children: [] }])
  );
  const roots: FolderTreeNode[] = [];
  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    const parent = folder.parentId ? nodes.get(folder.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/lib/folders/build-tree.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/db/prisma.ts src/lib/folders
git commit -m "Add Prisma client singleton, folder cycle-guard, and tree builder"
```

---

### Task 9: Folders API routes

**Files:**
- Create: `src/app/api/folders/route.ts`
- Create: `src/app/api/folders/[id]/route.ts`
- Test: `tests/integration/folders-api.test.ts`

**Interfaces:**
- Consumes: `prisma` (`@/lib/db/prisma`), `wouldCreateCycle` (`@/lib/folders/cycle-guard`).
- Produces: `POST /api/folders`, `GET /api/folders`, `PATCH /api/folders/:id`, `DELETE /api/folders/:id` — consumed by Task 11 (folder tree UI) and Task 15 (integration test).

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/folders-api.test.ts
import { describe, expect, it, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as foldersRoute from '@/app/api/folders/route';
import * as folderRoute from '@/app/api/folders/[id]/route';

async function createFolder(name: string, parentId: string | null = null) {
  const request = new NextRequest('http://localhost/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  });
  const response = await foldersRoute.POST(request);
  return { response, body: await response.json() };
}

beforeEach(async () => {
  await prisma.document.deleteMany();
  await prisma.folder.deleteMany();
});

afterAll(async () => {
  await prisma.document.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.$disconnect();
});

describe('folders API', () => {
  it('creates a root folder and lists it', async () => {
    const { response, body } = await createFolder('Contracts');
    expect(response.status).toBe(201);
    expect(body.name).toBe('Contracts');

    const listResponse = await foldersRoute.GET();
    const list = await listResponse.json();
    expect(list.map((f: { id: string }) => f.id)).toContain(body.id);
  });

  it('rejects an empty folder name', async () => {
    const { response } = await createFolder('   ');
    expect(response.status).toBe(400);
  });

  it('renames a folder', async () => {
    const { body: folder } = await createFolder('Original');
    const patchRequest = new NextRequest(`http://localhost/api/folders/${folder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    const patchResponse = await folderRoute.PATCH(patchRequest, {
      params: Promise.resolve({ id: folder.id }),
    });
    expect((await patchResponse.json()).name).toBe('Renamed');
  });

  it('rejects reparenting a folder into its own descendant', async () => {
    const { body: parent } = await createFolder('Parent');
    const { body: child } = await createFolder('Child', parent.id);
    const patchRequest = new NextRequest(`http://localhost/api/folders/${parent.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: child.id }),
    });
    const patchResponse = await folderRoute.PATCH(patchRequest, {
      params: Promise.resolve({ id: parent.id }),
    });
    expect(patchResponse.status).toBe(400);
  });

  it('deleting a folder reparents its children to the deleted folder\'s parent', async () => {
    const { body: parent } = await createFolder('Parent');
    const { body: child } = await createFolder('Child', parent.id);
    const { body: grandchild } = await createFolder('Grandchild', child.id);

    const deleteRequest = new NextRequest(`http://localhost/api/folders/${child.id}`, {
      method: 'DELETE',
    });
    await folderRoute.DELETE(deleteRequest, { params: Promise.resolve({ id: child.id }) });

    const reloaded = await prisma.folder.findUnique({ where: { id: grandchild.id } });
    expect(reloaded?.parentId).toBe(parent.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/folders-api.test.ts`
Expected: FAIL — route modules not found. (Requires `esign_app_test` to exist and be migrated, from Task 2.)

- [ ] **Step 3: Write `src/app/api/folders/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET() {
  const folders = await prisma.folder.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json(folders);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
  }
  const parentId = typeof body.parentId === 'string' ? body.parentId : null;
  if (parentId) {
    const parent = await prisma.folder.findUnique({ where: { id: parentId } });
    if (!parent) {
      return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });
    }
  }
  const folder = await prisma.folder.create({ data: { name, parentId } });
  return NextResponse.json(folder, { status: 201 });
}
```

- [ ] **Step 4: Write `src/app/api/folders/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { wouldCreateCycle } from '@/lib/folders/cycle-guard';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.folder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  const data: { name?: string; parentId?: string | null } = {};

  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Folder name cannot be empty' }, { status: 400 });
    }
    data.name = trimmed;
  }

  if ('parentId' in body) {
    const newParentId: string | null = body.parentId;
    if (newParentId !== null) {
      const parent = await prisma.folder.findUnique({ where: { id: newParentId } });
      if (!parent) {
        return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });
      }
      const all = await prisma.folder.findMany({ select: { id: true, parentId: true } });
      if (wouldCreateCycle(all, id, newParentId)) {
        return NextResponse.json(
          { error: 'Cannot move a folder into its own descendant' },
          { status: 400 }
        );
      }
    }
    data.parentId = newParentId;
  }

  const updated = await prisma.folder.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.folder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.document.updateMany({
      where: { folderId: id },
      data: { folderId: existing.parentId },
    }),
    prisma.folder.updateMany({
      where: { parentId: id },
      data: { parentId: existing.parentId },
    }),
    prisma.folder.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/folders-api.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/folders tests/integration/folders-api.test.ts
git commit -m "Add folders API: create, list, rename, reparent, delete"
```

---

### Task 10: Documents API routes

**Files:**
- Create: `src/app/api/documents/route.ts`
- Create: `src/app/api/documents/[id]/route.ts`
- Create: `src/app/api/documents/[id]/file/route.ts`
- Create: `src/app/api/documents/[id]/thumbnail/route.ts`
- Test: `tests/integration/documents-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getDocumentStorage`/`getThumbnailStorage` (`@/lib/storage`), `sha256Hex` (`@/lib/pdf/hash`), `assertValidPdf`/`InvalidPdfError` (`@/lib/pdf/validate`), `getPdfPageCount`/`renderPdfPageToPng` (`@/lib/pdf/render`), `makeTestPdf` (`tests/fixtures/make-test-pdf`).
- Produces: `POST /api/documents`, `GET /api/documents?folderId=`, `GET /api/documents/:id`, `PATCH /api/documents/:id`, `GET /api/documents/:id/file`, `GET /api/documents/:id/thumbnail` — consumed by Task 12/13/14 (UI) and Task 15.

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/documents-api.test.ts
import { describe, expect, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/db/prisma';
import { makeTestPdf } from '../fixtures/make-test-pdf';
import * as documentsRoute from '@/app/api/documents/route';
import * as documentRoute from '@/app/api/documents/[id]/route';
import * as fileRoute from '@/app/api/documents/[id]/file/route';
import * as thumbnailRoute from '@/app/api/documents/[id]/thumbnail/route';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'esign-docs-test-'));
  process.env.ESIGN_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await prisma.document.deleteMany();
  await prisma.folder.deleteMany();
});

afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ESIGN_DATA_DIR;
  await prisma.document.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.$disconnect();
});

async function uploadPdf(fileName: string, pageCount: number) {
  const pdfBytes = await makeTestPdf(pageCount);
  const formData = new FormData();
  formData.append('file', new File([pdfBytes], fileName, { type: 'application/pdf' }));
  const request = new NextRequest('http://localhost/api/documents', {
    method: 'POST',
    body: formData,
  });
  const response = await documentsRoute.POST(request);
  return { response, body: await response.json() };
}

describe('documents API', () => {
  it('rejects a non-PDF upload', async () => {
    const formData = new FormData();
    formData.append('file', new File([Buffer.from('not a pdf')], 'fake.pdf', { type: 'application/pdf' }));
    const request = new NextRequest('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    });
    const response = await documentsRoute.POST(request);
    expect(response.status).toBe(400);
    expect(await prisma.document.count()).toBe(0);
  });

  it('uploads a valid PDF, extracts page count, and defaults to DRAFT', async () => {
    const { response, body } = await uploadPdf('agreement.pdf', 3);
    expect(response.status).toBe(201);
    expect(body.status).toBe('DRAFT');
    expect(body.pageCount).toBe(3);
    expect(body.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serves the uploaded file bytes back with a PDF content type', async () => {
    const { body: document } = await uploadPdf('serve.pdf', 1);
    const request = new NextRequest(`http://localhost/api/documents/${document.id}/file`);
    const response = await fileRoute.GET(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('serves a generated thumbnail as a PNG', async () => {
    const { body: document } = await uploadPdf('thumb.pdf', 1);
    const request = new NextRequest(`http://localhost/api/documents/${document.id}/thumbnail`);
    const response = await thumbnailRoute.GET(request, {
      params: Promise.resolve({ id: document.id }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
  });

  it('lists only root-level documents when folderId=root', async () => {
    await uploadPdf('root-doc.pdf', 1);
    const request = new NextRequest('http://localhost/api/documents?folderId=root');
    const response = await documentsRoute.GET(request);
    const list = await response.json();
    expect(list.length).toBe(1);
    expect(list[0].folderId).toBeNull();
  });

  it('moves a document into a folder via PATCH', async () => {
    const { body: document } = await uploadPdf('movable.pdf', 1);
    const folder = await prisma.folder.create({ data: { name: 'Target' } });
    const patchRequest = new NextRequest(`http://localhost/api/documents/${document.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: folder.id }),
    });
    const patchResponse = await documentRoute.PATCH(patchRequest, {
      params: Promise.resolve({ id: document.id }),
    });
    expect((await patchResponse.json()).folderId).toBe(folder.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/documents-api.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write `src/app/api/documents/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getThumbnailStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { assertValidPdf, InvalidPdfError } from '@/lib/pdf/validate';
import { getPdfPageCount, renderPdfPageToPng } from '@/lib/pdf/render';

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

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A file field is required' }, { status: 400 });
  }
  const folderIdField = formData.get('folderId');
  const folderId =
    typeof folderIdField === 'string' && folderIdField.length > 0 ? folderIdField : null;

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    assertValidPdf(buffer);
  } catch (error) {
    if (error instanceof InvalidPdfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }
  }

  const fileHash = sha256Hex(buffer);
  const storageKey = `${fileHash}.pdf`;
  await getDocumentStorage().save(storageKey, buffer);

  const pageCount = await getPdfPageCount(buffer);

  let thumbnailKey: string | null = null;
  try {
    const thumbnailPng = await renderPdfPageToPng(buffer, 1);
    thumbnailKey = `${fileHash}.png`;
    await getThumbnailStorage().save(thumbnailKey, thumbnailPng);
  } catch (error) {
    console.error('Thumbnail generation failed', error);
    thumbnailKey = null;
  }

  const document = await prisma.document.create({
    data: {
      title: file.name.replace(/\.pdf$/i, ''),
      folderId,
      originalFilename: file.name,
      fileHash,
      storageKey,
      thumbnailKey,
      pageCount,
      fileSizeBytes: buffer.byteLength,
      status: 'DRAFT',
    },
  });

  return NextResponse.json(document, { status: 201 });
}
```

- [ ] **Step 4: Write `src/app/api/documents/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  return NextResponse.json(document);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const data: { folderId?: string | null } = {};
  if ('folderId' in body) {
    const folderId: string | null = body.folderId;
    if (folderId !== null) {
      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
      }
    }
    data.folderId = folderId;
  }

  const updated = await prisma.document.update({ where: { id }, data });
  return NextResponse.json(updated);
}
```

- [ ] **Step 5: Write `src/app/api/documents/[id]/file/route.ts` and `.../thumbnail/route.ts`**

```ts
// src/app/api/documents/[id]/file/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  const bytes = await getDocumentStorage().read(document.storageKey);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${document.originalFilename}"`,
    },
  });
}
```

```ts
// src/app/api/documents/[id]/thumbnail/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getThumbnailStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document || !document.thumbnailKey) {
    return NextResponse.json({ error: 'Thumbnail not available' }, { status: 404 });
  }
  const bytes = await getThumbnailStorage().read(document.thumbnailKey);
  return new NextResponse(bytes, { headers: { 'Content-Type': 'image/png' } });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/integration/documents-api.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/documents tests/integration/documents-api.test.ts
git commit -m "Add documents API: upload, list, move, file/thumbnail streaming"
```

---

### Task 11: Folder tree sidebar component

**Files:**
- Create: `src/components/folder-tree.tsx`

**Interfaces:**
- Consumes: `buildFolderTree`, `FolderRecord`, `FolderTreeNode` (`@/lib/folders/build-tree`); `GET/POST /api/folders`, `PATCH/DELETE /api/folders/:id`, `PATCH /api/documents/:id` (Task 9/10).
- Produces: `<FolderTree selectedFolderId parentId onSelectFolder refreshToken />` — consumed by Task 13 (dashboard composition).

- [ ] **Step 1: Write the component**

```tsx
// src/components/folder-tree.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { buildFolderTree, type FolderRecord, type FolderTreeNode } from '@/lib/folders/build-tree';

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  refreshToken: number;
}

export function FolderTree({ selectedFolderId, onSelectFolder, refreshToken }: FolderTreeProps) {
  const [folders, setFolders] = useState<FolderRecord[]>([]);

  const loadFolders = useCallback(async () => {
    const response = await fetch('/api/folders');
    setFolders(await response.json());
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders, refreshToken]);

  async function createFolder(parentId: string | null) {
    const name = window.prompt('Folder name');
    if (!name) return;
    await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
    loadFolders();
  }

  async function renameFolder(id: string, currentName: string) {
    const name = window.prompt('Rename folder', currentName);
    if (!name || name === currentName) return;
    await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    loadFolders();
  }

  async function deleteFolder(id: string) {
    if (!window.confirm('Delete this folder? Its documents and subfolders move up one level.')) {
      return;
    }
    await fetch(`/api/folders/${id}`, { method: 'DELETE' });
    if (selectedFolderId === id) onSelectFolder(null);
    loadFolders();
  }

  async function reparentFolder(id: string, newParentId: string | null) {
    await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: newParentId }),
    });
    loadFolders();
  }

  async function moveDocumentToFolder(documentId: string, folderId: string | null) {
    await fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    });
  }

  function handleDrop(event: React.DragEvent, targetFolderId: string | null) {
    event.preventDefault();
    const folderId = event.dataTransfer.getData('application/x-esign-folder-id');
    const documentId = event.dataTransfer.getData('application/x-esign-document-id');
    if (folderId && folderId !== targetFolderId) {
      reparentFolder(folderId, targetFolderId);
    } else if (documentId) {
      moveDocumentToFolder(documentId, targetFolderId);
    }
  }

  const tree = buildFolderTree(folders);

  return (
    <nav className="flex flex-col gap-1 p-3 text-sm">
      <button
        className={`rounded px-2 py-1 text-left hover:bg-neutral-100 ${
          selectedFolderId === null ? 'bg-neutral-100 font-medium' : ''
        }`}
        onClick={() => onSelectFolder(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, null)}
      >
        Home
      </button>
      {tree.map((node) => (
        <FolderNode
          key={node.id}
          node={node}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          onCreateChild={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
          onDrop={handleDrop}
        />
      ))}
      <button
        className="mt-2 rounded px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100"
        onClick={() => createFolder(null)}
      >
        + New folder
      </button>
    </nav>
  );
}

interface FolderNodeProps {
  node: FolderTreeNode;
  depth: number;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateChild: (parentId: string | null) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string) => void;
  onDrop: (event: React.DragEvent, targetFolderId: string | null) => void;
}

function FolderNode({
  node,
  depth,
  selectedFolderId,
  onSelectFolder,
  onCreateChild,
  onRename,
  onDelete,
  onDrop,
}: FolderNodeProps) {
  return (
    <div>
      <div
        className={`group flex items-center justify-between rounded px-2 py-1 hover:bg-neutral-100 ${
          selectedFolderId === node.id ? 'bg-neutral-100 font-medium' : ''
        }`}
        style={{ paddingLeft: depth * 14 + 8 }}
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData('application/x-esign-folder-id', node.id)
        }
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onDrop(event, node.id)}
        onClick={() => onSelectFolder(node.id)}
      >
        <span className="truncate">{node.name}</span>
        <span className="hidden gap-1 group-hover:flex">
          <button onClick={(e) => { e.stopPropagation(); onCreateChild(node.id); }} title="New subfolder">
            +
          </button>
          <button onClick={(e) => { e.stopPropagation(); onRename(node.id, node.name); }} title="Rename">
            ✎
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} title="Delete">
            ✕
          </button>
        </span>
      </div>
      {node.children.map((child) => (
        <FolderNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          onCreateChild={onCreateChild}
          onRename={onRename}
          onDelete={onDelete}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/folder-tree.tsx
git commit -m "Add folder tree sidebar with create/rename/delete/drag-drop"
```

---

### Task 12: Upload dropzone & document grid components

**Files:**
- Create: `src/components/upload-dropzone.tsx`
- Create: `src/components/document-grid.tsx`
- Create: `public/pdf-placeholder.svg`

**Interfaces:**
- Consumes: `POST /api/documents`, `GET /api/documents/:id/thumbnail` (Task 10).
- Produces: `<UploadDropzone folderId onUploaded />`, `<DocumentGrid documents />`, `DocumentSummary` type — consumed by Task 13.

- [ ] **Step 1: Write `public/pdf-placeholder.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
  <path d="M15 2v5h5" />
  <text x="12" y="16" font-size="5" text-anchor="middle" fill="currentColor" stroke="none">PDF</text>
</svg>
```

- [ ] **Step 2: Write `src/components/upload-dropzone.tsx`**

```tsx
'use client';

import { useCallback, useRef, useState } from 'react';

interface UploadDropzoneProps {
  folderId: string | null;
  onUploaded: () => void;
}

export function UploadDropzone({ folderId, onUploaded }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const nextErrors: string[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        if (folderId) formData.append('folderId', folderId);
        const response = await fetch('/api/documents', { method: 'POST', body: formData });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: 'Upload failed' }));
          nextErrors.push(`${file.name}: ${body.error ?? 'Upload failed'}`);
        }
      }
      setErrors(nextErrors);
      onUploaded();
    },
    [folderId, onUploaded]
  );

  return (
    <div
      className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
        isDragging ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (event.dataTransfer.files.length > 0) {
          uploadFiles(event.dataTransfer.files);
        }
      }}
    >
      <p className="text-neutral-600">
        Drag PDFs here, or{' '}
        <button className="underline" onClick={() => inputRef.current?.click()}>
          browse
        </button>
      </p>
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
      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 text-left text-red-600">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/document-grid.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export interface DocumentSummary {
  id: string;
  title: string;
  status: string;
  thumbnailKey: string | null;
  updatedAt: string;
  folderId: string | null;
}

interface DocumentGridProps {
  documents: DocumentSummary[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
};

type SortKey = 'title' | 'updatedAt' | 'status';

export function DocumentGrid({ documents }: DocumentGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const sorted = useMemo(() => {
    return [...documents].sort((a, b) => {
      if (sortKey === 'updatedAt') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      return a[sortKey].localeCompare(b[sortKey]);
    });
  }, [documents, sortKey]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <select
          className="rounded border px-2 py-1 text-sm"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
        >
          <option value="updatedAt">Last updated</option>
          <option value="title">Title</option>
          <option value="status">Status</option>
        </select>
        <div className="flex gap-2 text-sm">
          <button
            className={view === 'grid' ? 'font-medium underline' : 'text-neutral-500'}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            className={view === 'list' ? 'font-medium underline' : 'text-neutral-500'}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>
      {sorted.length === 0 && (
        <p className="py-12 text-center text-sm text-neutral-400">No documents here yet.</p>
      )}
      <div className={view === 'grid' ? 'grid grid-cols-4 gap-4' : 'flex flex-col divide-y'}>
        {sorted.map((doc) => (
          <Link
            key={doc.id}
            href={`/documents/${doc.id}`}
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
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/upload-dropzone.tsx src/components/document-grid.tsx public/pdf-placeholder.svg
git commit -m "Add upload dropzone and document grid/list components"
```

---

### Task 13: Dashboard page composition

**Files:**
- Create: `src/app/dashboard/dashboard-client.tsx`
- Create: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `<FolderTree>` (Task 11), `<UploadDropzone>`, `<DocumentGrid>`, `DocumentSummary` (Task 12), `GET /api/documents` (Task 10).

- [ ] **Step 1: Write `src/app/dashboard/dashboard-client.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderTree } from '@/components/folder-tree';
import { UploadDropzone } from '@/components/upload-dropzone';
import { DocumentGrid, type DocumentSummary } from '@/components/document-grid';

export function DashboardClient() {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadDocuments = useCallback(async () => {
    const query = selectedFolderId ? `?folderId=${selectedFolderId}` : '?folderId=root';
    const response = await fetch(`/api/documents${query}`);
    setDocuments(await response.json());
  }, [selectedFolderId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments, refreshToken]);

  return (
    <div className="flex h-screen">
      <aside className="w-64 shrink-0 overflow-y-auto border-r">
        <FolderTree
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          refreshToken={refreshToken}
        />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <UploadDropzone
          folderId={selectedFolderId}
          onUploaded={() => setRefreshToken((t) => t + 1)}
        />
        <div className="mt-6">
          <DocumentGrid documents={documents} />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/dashboard/page.tsx`**

```tsx
import { DashboardClient } from './dashboard-client';

export default function DashboardPage() {
  return <DashboardClient />;
}
```

- [ ] **Step 3: Manual verification**

Run: `./scripts/setup-db.sh && npm run db:generate && npm run dev`
Then open `http://localhost:3000/` in a browser.
Expected: redirects to `/dashboard`, shows an empty state with "Home" selected and no documents.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard
git commit -m "Compose dashboard: folder sidebar, upload dropzone, document grid"
```

---

### Task 14: PDF viewer page

**Files:**
- Create: `src/components/pdf-viewer.tsx`
- Create: `src/app/documents/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/documents/:id/file` (Task 10), `prisma` (Task 8).
- Produces: `<PdfViewer documentId title />`, route `/documents/:id`.

- [ ] **Step 1: Write `src/components/pdf-viewer.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfViewerProps {
  documentId: string;
  title: string;
}

export function PdfViewer({ documentId, title }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    pdfjsLib.getDocument(`/api/documents/${documentId}/file`).promise.then((doc) => {
      if (cancelled) return;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    pdfDoc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d')!;
      page.render({ canvasContext: context, viewport });
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="truncate font-medium">{title}</h1>
        <div className="flex items-center gap-3 text-sm">
          <button disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => p - 1)}>
            Prev
          </button>
          <span>
            Page {pageNumber} of {numPages}
          </span>
          <button disabled={pageNumber >= numPages} onClick={() => setPageNumber((p) => p + 1)}>
            Next
          </button>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>-</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
        </div>
      </header>
      <div className="flex-1 overflow-auto bg-neutral-100 p-6">
        <canvas ref={canvasRef} className="mx-auto shadow" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/documents/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { PdfViewer } from '@/components/pdf-viewer';

export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) notFound();
  return <PdfViewer documentId={document.id} title={document.title} />;
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, upload a multi-page PDF from the dashboard, click it.
Expected: viewer opens, page renders, Next/Prev navigate pages, +/- change zoom.

- [ ] **Step 4: Commit**

```bash
git add src/components/pdf-viewer.tsx src/app/documents
git commit -m "Add client-side PDF viewer with page navigation and zoom"
```

---

### Task 15: End-to-end integration test (upload → list → move → viewer metadata)

**Files:**
- Create: `tests/integration/document-lifecycle.test.ts`

**Interfaces:**
- Consumes: all API route modules from Tasks 9 and 10, `makeTestPdf` from Task 7.

- [ ] **Step 1: Write the test**

```ts
// tests/integration/document-lifecycle.test.ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/db/prisma';
import { makeTestPdf } from '../fixtures/make-test-pdf';
import * as documentsRoute from '@/app/api/documents/route';
import * as documentRoute from '@/app/api/documents/[id]/route';
import * as foldersRoute from '@/app/api/folders/route';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'esign-lifecycle-'));
  process.env.ESIGN_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await prisma.document.deleteMany();
  await prisma.folder.deleteMany();
});

afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ESIGN_DATA_DIR;
  await prisma.document.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.$disconnect();
});

describe('full document lifecycle', () => {
  it('uploads, lists at root, moves into a folder, and exposes viewer metadata', async () => {
    const folderRequest = new NextRequest('http://localhost/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Contracts' }),
    });
    const folder = await (await foldersRoute.POST(folderRequest)).json();

    const pdfBytes = await makeTestPdf(3);
    const formData = new FormData();
    formData.append('file', new File([pdfBytes], 'agreement.pdf', { type: 'application/pdf' }));
    const uploadRequest = new NextRequest('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    });
    const uploadResponse = await documentsRoute.POST(uploadRequest);
    const document = await uploadResponse.json();
    expect(uploadResponse.status).toBe(201);
    expect(document.status).toBe('DRAFT');
    expect(document.pageCount).toBe(3);

    const listRequest = new NextRequest('http://localhost/api/documents?folderId=root');
    const rootDocuments = await (await documentsRoute.GET(listRequest)).json();
    expect(rootDocuments.map((d: { id: string }) => d.id)).toContain(document.id);

    const moveRequest = new NextRequest(`http://localhost/api/documents/${document.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: folder.id }),
    });
    const moved = await (
      await documentRoute.PATCH(moveRequest, { params: Promise.resolve({ id: document.id }) })
    ).json();
    expect(moved.folderId).toBe(folder.id);

    const inFolderRequest = new NextRequest(`http://localhost/api/documents?folderId=${folder.id}`);
    const inFolderDocuments = await (await documentsRoute.GET(inFolderRequest)).json();
    expect(inFolderDocuments.map((d: { id: string }) => d.id)).toEqual([document.id]);

    const getRequest = new NextRequest(`http://localhost/api/documents/${document.id}`);
    const fetched = await (
      await documentRoute.GET(getRequest, { params: Promise.resolve({ id: document.id }) })
    ).json();
    expect(fetched.pageCount).toBe(3);
    expect(fetched.fileHash).toBe(document.fileHash);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/integration/document-lifecycle.test.ts`
Expected: PASS (1 test). If it fails on the Postgres connection, re-run `./scripts/setup-db.sh` and confirm `.env.test` points at `esign_app_test`.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all tests across every task pass together.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/document-lifecycle.test.ts
git commit -m "Add end-to-end integration test for the document lifecycle"
```

---

### Task 16: Manual end-to-end verification in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

Run: `./scripts/setup-db.sh && npm run db:generate && npm run dev`
Open `http://localhost:3000`.

- [ ] **Step 2: Verify direct-to-dashboard launch**

Navigate to `http://localhost:3000/`. Expected: immediately redirects to `/dashboard`, no login screen.

- [ ] **Step 3: Verify folder CRUD and nesting**

Create a folder "Contracts", then a subfolder "2026" inside it via the `+` on hover. Rename "2026" to "2026 Q1". Expected: sidebar tree updates immediately after each action, indentation reflects nesting.

- [ ] **Step 4: Verify upload**

Drag a real multi-page PDF onto the dropzone while "Contracts" is selected. Expected: it appears in the grid within a couple seconds with a real thumbnail (not the placeholder icon) and a "Draft" badge.

- [ ] **Step 5: Verify drag-and-drop move**

Drag the uploaded document card onto "Home" in the sidebar. Expected: document disappears from the "Contracts" view; selecting "Home" shows it there.

- [ ] **Step 6: Verify the viewer**

Click the document. Expected: opens `/documents/:id`, renders page 1, "Next"/"Prev" move between pages, "+"/"-" change zoom level, title bar shows the document title.

- [ ] **Step 7: Verify folder delete reparenting**

Delete "Contracts" (with "2026 Q1" still inside it). Confirm the dialog. Expected: "2026 Q1" reappears at the root level of the sidebar, not deleted.

- [ ] **Step 8: Verify rejection of a non-PDF**

Try dragging a `.txt` or `.png` file onto the dropzone. Expected: an inline error message naming the file, nothing added to the grid.

- [ ] **Step 9: Record results**

If every step above matches its expected result, Phase 1 is complete. If any step fails, file it as a bug against the relevant task before starting Phase 2 (template & field editor).
