import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
const COLLECTION_NAME = 'customers';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const customers = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return NextResponse.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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

    return NextResponse.json({ id, ...body }, { status: 201 });
  } catch (error) {
    console.error('Error adding customer:', error);
    return NextResponse.json(
      { error: 'Failed to add customer' },
      { status: 500 }
    );
  }
}
