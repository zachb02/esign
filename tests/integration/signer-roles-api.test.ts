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

  it('assigns a non-colliding order to a new role after a middle role is deleted', async () => {
    const template = await createTemplate();
    const { body: role1 } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    const { body: role2 } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    const { body: role3 } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );
    expect([role1.order, role2.order, role3.order]).toEqual([0, 1, 2]);

    const deleteRequest = new NextRequest(`http://localhost/api/signer-roles/${role2.id}`, {
      method: 'DELETE',
    });
    const deleteResponse = await signerRoleRoute.DELETE(deleteRequest, {
      params: Promise.resolve({ id: role2.id }),
    });
    expect(deleteResponse.status).toBe(200);

    const { body: role4 } = await createRole(
      new NextRequest('http://localhost/api/signer-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'template', ownerId: template.id }),
      })
    );

    expect(role4.order).toBe(3);
    expect(role4.colorIndex).toBe(3);
    expect(role4.order).not.toBe(role3.order);
  });
});
