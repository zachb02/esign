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
