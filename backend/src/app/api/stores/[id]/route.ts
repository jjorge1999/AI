import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { Store } from '@/lib/models';
import { withCors, corsResponse } from '@/lib/cors';
import { backendCache } from '@/lib/cache';

const CACHE_KEY = 'global:stores';

export async function OPTIONS(request: Request) {
  // ... existing OPTIONS ...
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { id } = await params;
    const doc = await db.collection('stores').doc(id).get();

    if (!doc.exists) {
      return withCors(
        NextResponse.json({ error: 'Store not found' }, { status: 404 }),
        origin
      );
    }

    const data = doc.data();
    const store = {
      ...data,
      id: doc.id,
      createdAt: data?.createdAt?.toDate
        ? data.createdAt.toDate()
        : data?.createdAt,
    } as Store;

    return withCors(NextResponse.json(store), origin);
  } catch (error) {
    console.error('Error fetching store:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch store' }, { status: 500 }),
      origin
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = request.headers.get('origin');
  try {
    const { id } = await params;
    const updateData = await request.json();

    // Clean body: remove fields that shouldn't be updated manually
    delete updateData.id;
    delete updateData.createdAt;

    await db.collection('stores').doc(id).update(updateData);
    backendCache.delete(CACHE_KEY);
    return withCors(NextResponse.json({ id, ...updateData }), origin);
  } catch (error) {
    const err = error as Error;
    console.error('Error updating store:', err);
    return withCors(
      NextResponse.json(
        {
          error: 'Failed to update store',
          details: err.message,
        },
        { status: 500 }
      ),
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

    // Check if store is protected before deletion
    const storeDoc = await db.collection('stores').doc(id).get();
    if (storeDoc.exists) {
      const storeData = storeDoc.data();
      if (storeData?.isSuperAdminOnly) {
        return withCors(
          NextResponse.json(
            { error: 'Protected store cannot be deleted' },
            { status: 403 }
          ),
          origin
        );
      }
    }

    await db.collection('stores').doc(id).delete();
    backendCache.delete(CACHE_KEY);
    return withCors(NextResponse.json({ success: true }), origin);
  } catch (error) {
    console.error('Error deleting store:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to delete store' }, { status: 500 }),
      origin
    );
  }
}
