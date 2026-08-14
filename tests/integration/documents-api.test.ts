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
import { getDocumentStorage } from '@/lib/storage';

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

  it('rejects a corrupt PDF that passes the magic-byte check without writing storage or DB rows', async () => {
    const corruptPdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('this is not real pdf content, just garbage bytes after the magic header'),
    ]);
    const formData = new FormData();
    formData.append('file', new File([corruptPdf], 'corrupt.pdf', { type: 'application/pdf' }));
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
});
