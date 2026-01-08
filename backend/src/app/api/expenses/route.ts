import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

import { backendCache } from '@/lib/cache';

const COLLECTION_NAME = 'expenses';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const storeId = searchParams.get('storeId');

    const cacheKey = `expenses:${userId || 'null'}:${storeId || 'null'}`;
    const cachedData = backendCache.get(cacheKey);
    if (cachedData) {
      console.log('Serving expenses from cache:', cacheKey);
      return withCors(NextResponse.json(cachedData), origin);
    }

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    if (storeId) {
      query = query.where('storeId', '==', storeId);
    } else if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const expenses = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Cache for 2 minutes
    backendCache.set(cacheKey, expenses, 120);

    return withCors(NextResponse.json(expenses), origin);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 }),
      origin
    );
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const body = await request.json();
    let id = body.id;

    if (id) {
      await db
        .collection(COLLECTION_NAME)
        .doc(id)
        .set({
          ...body,
          timestamp: body.timestamp || new Date(),
        });
    } else {
      const docRef = await db.collection(COLLECTION_NAME).add({
        ...body,
        timestamp: new Date(),
      });
      id = docRef.id;
    }

    // Invalidate Cache
    const cacheKey = `expenses:${body.userId || 'null'}:${
      body.storeId || 'null'
    }`;
    backendCache.delete(cacheKey);

    return withCors(
      NextResponse.json({ id, ...body }, { status: 201 }),
      origin
    );
  } catch (error) {
    console.error('Error adding expense:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to add expense' }, { status: 500 }),
      origin
    );
  }
}
