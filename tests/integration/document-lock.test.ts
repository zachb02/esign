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
