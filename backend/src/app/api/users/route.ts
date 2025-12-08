import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

const COLLECTION_NAME = 'users';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get('username');
    const userId = searchParams.get('userId');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    if (username) {
      query = query.where('username', '==', username);
    }

    if (userId) {
      query = query.where('id', '==', userId);
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

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let id = body.id;

    // For users, if ID is provided (like 'admin-1'), use it.
    // Otherwise fallback to auto-id which is standard, but usually we want username uniqueness or specific IDs.
    // The previous service code sent 'admin-1' explicitly.

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

    return NextResponse.json({ id, ...body }, { status: 201 });
  } catch (error) {
    console.error('Error adding user:', error);
    return NextResponse.json({ error: 'Failed to add user' }, { status: 500 });
  }
}
