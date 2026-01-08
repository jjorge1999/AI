import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { Store } from '@/lib/models';
import { withCors, corsResponse } from '@/lib/cors';
import { backendCache } from '@/lib/cache';

const CACHE_KEY = 'global:stores';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const cached = backendCache.get<Store[]>(CACHE_KEY);
    if (cached) {
      console.log('Serving stores from backend cache');
      return withCors(NextResponse.json(cached), origin);
    }

    const storesSnapshot = await db
      .collection('stores')
      .orderBy('createdAt', 'desc')
      .get();
    const stores: Store[] = [];

    storesSnapshot.forEach((doc) => {
      const data = doc.data();
      stores.push({
        ...data,
        id: doc.id,
        createdAt: data.createdAt?.toDate
          ? data.createdAt.toDate()
          : data.createdAt,
      } as Store);
    });

    backendCache.set(CACHE_KEY, stores, 300); // 5 minute cache

    return withCors(NextResponse.json(stores), origin);
  } catch (error) {
    console.error('Error fetching stores:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch stores' }, { status: 500 }),
      origin
    );
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const body = await request.json();
    const id = crypto.randomUUID();

    const newStore: Partial<Store> = {
      ...body,
      id,
      createdAt: new Date().toISOString(),
    };

    await db.collection('stores').doc(id).set(newStore);
    backendCache.delete(CACHE_KEY);

    return withCors(NextResponse.json(newStore), origin);
  } catch (error) {
    console.error('Error creating store:', error);
    return withCors(
      NextResponse.json(
        { error: 'Failed to create store', message: error },
        { status: 500 }
      ),
      origin
    );
  }
}
