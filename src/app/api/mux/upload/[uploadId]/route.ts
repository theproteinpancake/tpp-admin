import { NextResponse } from 'next/server';
import { getUploadStatus } from '@/lib/mux';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  try {
    const { uploadId } = await params;
    const upload = await getUploadStatus(uploadId);
    return NextResponse.json(upload);
  } catch (error) {
    console.error('Error getting upload status:', error);
    return NextResponse.json(
      { error: 'Failed to get upload status' },
      { status: 500 }
    );
  }
}
