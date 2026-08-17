import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as settingsRoute from '@/app/api/settings/route';

beforeEach(async () => {
  await prisma.appSettings.deleteMany();
});

afterAll(async () => {
  await prisma.appSettings.deleteMany();
  await prisma.$disconnect();
});

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('settings API', () => {
  it('reports both providers as unconfigured by default', async () => {
    const response = await settingsRoute.GET();
    const body = await response.json();
    expect(body).toEqual({ openaiConfigured: false, anthropicConfigured: false });
  });

  it('never echoes a saved key back in GET or PATCH responses', async () => {
    const patchResponse = await settingsRoute.PATCH(patchRequest({ anthropicApiKey: 'sk-ant-secret' }));
    const patchBody = await patchResponse.json();
    expect(patchResponse.status).toBe(200);
    expect(patchBody).toEqual({ openaiConfigured: false, anthropicConfigured: true });
    expect(JSON.stringify(patchBody)).not.toContain('sk-ant-secret');

    const getResponse = await settingsRoute.GET();
    const getBody = await getResponse.json();
    expect(getBody).toEqual({ openaiConfigured: false, anthropicConfigured: true });
  });

  it('sets both keys independently', async () => {
    await settingsRoute.PATCH(patchRequest({ openaiApiKey: 'sk-openai-secret' }));
    await settingsRoute.PATCH(patchRequest({ anthropicApiKey: 'sk-ant-secret' }));
    const response = await settingsRoute.GET();
    const body = await response.json();
    expect(body).toEqual({ openaiConfigured: true, anthropicConfigured: true });
  });

  it('clears a key when explicitly set to null', async () => {
    await settingsRoute.PATCH(patchRequest({ anthropicApiKey: 'sk-ant-secret' }));
    const response = await settingsRoute.PATCH(patchRequest({ anthropicApiKey: null }));
    const body = await response.json();
    expect(body.anthropicConfigured).toBe(false);
  });

  it('leaves a key unchanged when omitted from the PATCH body', async () => {
    await settingsRoute.PATCH(patchRequest({ anthropicApiKey: 'sk-ant-secret' }));
    const response = await settingsRoute.PATCH(patchRequest({ openaiApiKey: 'sk-openai-secret' }));
    const body = await response.json();
    expect(body).toEqual({ openaiConfigured: true, anthropicConfigured: true });
  });

  it('rejects an empty-string key with 400', async () => {
    const response = await settingsRoute.PATCH(patchRequest({ openaiApiKey: '' }));
    expect(response.status).toBe(400);
  });

  it('rejects a malformed JSON body with 400 instead of crashing', async () => {
    const request = new NextRequest('http://localhost/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const response = await settingsRoute.PATCH(request);
    expect(response.status).toBe(400);
  });
});
