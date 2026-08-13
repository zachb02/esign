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
