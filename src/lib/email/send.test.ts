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

  it('HTML-escapes recipient name and document title in the html body', () => {
    // Recipient name/document title are free text with no format validation;
    // unescaped interpolation would let a name like "<img src=x onerror=...>"
    // inject markup into the recipient's own email client.
    const options = buildSigningLinkMailOptions(
      'jane@example.com',
      '<script>alert(1)</script>',
      'Contract & Terms "2026"',
      'http://localhost:3000/sign/abc123',
      'esign@example.com'
    );
    expect(options.html).not.toContain('<script>');
    expect(options.html).toContain('&lt;script&gt;');
    expect(options.html).toContain('Contract &amp; Terms &quot;2026&quot;');
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
