import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { Expense } from '@/lib/models';

const COLLECTION_NAME = 'expenses';

export async function GET() {
  try {
    const snapshot = await db.collection(COLLECTION_NAME).get();
    const expenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json(expenses);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let id = body.id;

    if (id) {
      await db.collection(COLLECTION_NAME).doc(id).set({
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

    return NextResponse.json({ id, ...body }, { status: 201 });
  } catch (error) {
    console.error('Error adding expense:', error);
    return NextResponse.json({ error: 'Failed to add expense' }, { status: 500 });
  }
}
