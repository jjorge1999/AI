import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

const COLLECTION_NAME = 'expenses';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { id } = await params;
    const body = await request.json();
    await db.collection(COLLECTION_NAME).doc(id).update(body);
    return withCors(NextResponse.json({ id, ...body }), origin);
  } catch (error) {
    console.error('Error updating expense:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to update expense' }, { status: 500 }),
      origin
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { id } = await params;
    await db.collection(COLLECTION_NAME).doc(id).delete();
    return withCors(NextResponse.json({ message: 'Expense deleted' }), origin);
  } catch (error) {
    console.error('Error deleting expense:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 }),
      origin
    );
  }
}
