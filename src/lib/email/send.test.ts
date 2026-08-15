import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildSigningLinkMailOptions, isEmailConfigured } from './send';

describe('buildSigningLinkMailOptions', () => {
  it('includes the signing link in both text and html bodies', () => {
    const options = buildSigningLinkMailOptions(
      'jane@example.com',
      'Jane Doe',
      'Contract',
      'http://localhost:3000/sign/abc123',
      'esign@example.com'
    );
    expect(options.to).toBe('jane@example.com');
    expect(options.from).toBe('esign@example.com');
    expect(options.subject).toContain('Contract');
    expect(options.text).toContain('http://localhost:3000/sign/abc123');
    expect(options.html).toContain('http://localhost:3000/sign/abc123');
  });
});

describe('isEmailConfigured', () => {
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
  let originalValues: Record<string, string | undefined>;

  beforeEach(() => {
    originalValues = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const key of keys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      if (originalValues[key] === undefined) delete process.env[key];
      else process.env[key] = originalValues[key];
    }
  });

  it('is false when no SMTP env vars are set', () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it('is false when only some SMTP env vars are set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    expect(isEmailConfigured()).toBe(false);
  });

  it('is true when all five SMTP env vars are set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASSWORD = 'pass';
    process.env.SMTP_FROM = 'esign@example.com';
    expect(isEmailConfigured()).toBe(true);
  });
});
