import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

const COLLECTION_NAME = 'users';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const userId = searchParams.get('userId');
    const storeId = searchParams.get('storeId');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    if (username) {
      query = query.where('username', '==', username);
    }

    if (userId) {
      query = query.where('id', '==', userId);
    }

    if (storeId) {
      query = query.where('storeId', '==', storeId);
    }

    const snapshot = await query.get();
    const users = snapshot.docs.map((doc) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = doc.data() as any;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...safeData } = data;
      return {
        id: doc.id,
        ...safeData,
      };
    });

    return withCors(NextResponse.json(users), origin);
  } catch (error) {
    console.error('Error fetching users:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 }),
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
          createdAt: body.createdAt || new Date(),
        });
    } else {
      const docRef = await db.collection(COLLECTION_NAME).add({
        ...body,
        createdAt: new Date(),
      });
      id = docRef.id;
    }

    return withCors(
      NextResponse.json({ id, ...body }, { status: 201 }),
      origin
    );
  } catch (error) {
    console.error('Error adding user:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to add user' }, { status: 500 }),
      origin
    );
  }
}
