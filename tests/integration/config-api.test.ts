import { describe, expect, it } from 'vitest';
import * as configRoute from '@/app/api/config/route';

describe('GET /api/config', () => {
  it('reports emailConfigured as false when no SMTP env vars are set (the default state)', async () => {
    const response = await configRoute.GET();
    const body = await response.json();
    expect(body.emailConfigured).toBe(false);
  });
});
