import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { Store } from '@/lib/models';
import { withCors, corsResponse } from '@/lib/cors';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
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
