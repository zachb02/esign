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
