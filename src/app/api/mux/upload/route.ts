import { NextResponse } from 'next/server';
import { createDirectUpload } from '@/lib/mux';

export async function POST() {
  try {
    const upload = await createDirectUpload();
    return NextResponse.json(upload);
  } catch (error) {
    console.error('Error creating upload:', error);
    return NextResponse.json(
      { error: 'Failed to create upload URL' },
      { status: 500 }
    );
  }
}
