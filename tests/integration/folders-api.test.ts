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
