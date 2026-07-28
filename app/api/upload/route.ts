import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    ok: true,
    message: 'Upload endpoint ready for Supabase storage integration.',
  });
}
