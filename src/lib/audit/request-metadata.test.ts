import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getRequestIp, getRequestUserAgent } from './request-metadata';

describe('getRequestIp', () => {
  it('reads the first address from x-forwarded-for', () => {
    const request = new NextRequest('http://localhost/x', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    expect(getRequestIp(request)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const request = new NextRequest('http://localhost/x', {
      headers: { 'x-real-ip': '203.0.113.9' },
    });
    expect(getRequestIp(request)).toBe('203.0.113.9');
  });

  it('returns null when neither header is present', () => {
    const request = new NextRequest('http://localhost/x');
    expect(getRequestIp(request)).toBeNull();
  });
});

describe('getRequestUserAgent', () => {
  it('reads the user-agent header', () => {
    const request = new NextRequest('http://localhost/x', {
      headers: { 'user-agent': 'test-agent/1.0' },
    });
    expect(getRequestUserAgent(request)).toBe('test-agent/1.0');
  });

  it('returns null when absent', () => {
    const request = new NextRequest('http://localhost/x');
    expect(getRequestUserAgent(request)).toBeNull();
  });
});
