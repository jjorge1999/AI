import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import { backendCache } from '@/lib/cache';

const COLLECTION_NAME = 'users';
const CACHE_KEY_PREFIX = 'global:users';

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

    // Invalidate main lists
    backendCache.delete(`${CACHE_KEY_PREFIX}:all:all:all`);
    if (body.storeId) {
      backendCache.delete(`${CACHE_KEY_PREFIX}:all:all:${body.storeId}`);
    }

    return withCors(NextResponse.json({ id, ...body }), origin);
  } catch (error) {
    console.error('Error updating user:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to update user' }, { status: 500 }),
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

    // Invalidate main lists
    backendCache.delete(`${CACHE_KEY_PREFIX}:all:all:all`);

    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error) {
    console.error('Error deleting user:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to delete user' }, { status: 500 }),
      origin
    );
  }
}
