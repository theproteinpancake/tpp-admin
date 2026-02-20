import { NextResponse } from 'next/server';
import { createDirectUpload } from '@/lib/mux';

export async function POST() {
  try {
    const upload = await createDirectUpload();
    return NextResponse.json(upload);
  } catch (error: unknown) {
    console.error('Error creating upload:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      { error: 'Failed to create upload URL', details: message, status },
      { status: 500 }
    );
  }
}
