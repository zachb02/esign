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
