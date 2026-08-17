import { prisma } from '@/lib/db/prisma';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  return (
    <SettingsClient
      openaiConfigured={Boolean(settings?.openaiApiKey)}
      anthropicConfigured={Boolean(settings?.anthropicApiKey)}
    />
  );
}
