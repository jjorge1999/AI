import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

const COLLECTION_NAME = 'sales';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    await db.collection(COLLECTION_NAME).doc(id).update(body);
    return NextResponse.json({ id, ...body });
  } catch (error) {
    console.error('Error updating sale:', error);
    return NextResponse.json({ error: 'Failed to update sale' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await db.collection(COLLECTION_NAME).doc(id).delete();
    return NextResponse.json({ message: 'Sale deleted' });
  } catch (error) {
    console.error('Error deleting sale:', error);
    return NextResponse.json({ error: 'Failed to delete sale' }, { status: 500 });
  }
}
