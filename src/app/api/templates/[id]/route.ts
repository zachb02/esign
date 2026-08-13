import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  return NextResponse.json(template);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
  }
  const updated = await prisma.template.update({ where: { id }, data: { title } });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.template.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  await prisma.template.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
