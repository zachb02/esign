import type { NextRequest } from 'next/server';

export function getRequestIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}

export function getRequestUserAgent(request: NextRequest): string | null {
  return request.headers.get('user-agent');
}
