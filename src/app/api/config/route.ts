import { NextResponse } from 'next/server';
import { isEmailConfigured } from '@/lib/email/send';

export async function GET() {
  return NextResponse.json({ emailConfigured: isEmailConfigured() });
}
