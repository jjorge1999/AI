import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

const COLLECTION_NAME = 'sales';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    if (userId) {
      // Allow users to see their own sales AND public guest reservations
      query = query.where('userId', 'in', [userId, 'guest']);
    }

    const snapshot = await query.get();
    const sales = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return withCors(NextResponse.json(sales), origin);
  } catch (error) {
    console.error('Error fetching sales:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch sales' }, { status: 500 }),
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

    return withCors(
      NextResponse.json({ id, ...body }, { status: 201 }),
      origin
    );
  } catch (error) {
    console.error('Error adding sale:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to add sale' }, { status: 500 }),
      origin
    );
  }
}
