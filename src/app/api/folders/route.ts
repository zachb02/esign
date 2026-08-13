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
