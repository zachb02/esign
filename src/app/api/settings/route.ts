import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

const SETTINGS_ID = 'singleton';

export async function GET() {
  const settings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  return NextResponse.json({
    openaiConfigured: Boolean(settings?.openaiApiKey),
    anthropicConfigured: Boolean(settings?.anthropicApiKey),
  });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const data: { openaiApiKey?: string | null; anthropicApiKey?: string | null } = {};
  if ('openaiApiKey' in body) {
    if (body.openaiApiKey === null) {
      data.openaiApiKey = null;
    } else if (typeof body.openaiApiKey === 'string' && body.openaiApiKey.trim()) {
      data.openaiApiKey = body.openaiApiKey.trim();
    } else {
      return NextResponse.json({ error: 'openaiApiKey must be a non-empty string or null' }, { status: 400 });
    }
  }
  if ('anthropicApiKey' in body) {
    if (body.anthropicApiKey === null) {
      data.anthropicApiKey = null;
    } else if (typeof body.anthropicApiKey === 'string' && body.anthropicApiKey.trim()) {
      data.anthropicApiKey = body.anthropicApiKey.trim();
    } else {
      return NextResponse.json({ error: 'anthropicApiKey must be a non-empty string or null' }, { status: 400 });
    }
  }

  const settings = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, ...data },
    update: data,
  });

  return NextResponse.json({
    openaiConfigured: Boolean(settings.openaiApiKey),
    anthropicConfigured: Boolean(settings.anthropicApiKey),
  });
}
