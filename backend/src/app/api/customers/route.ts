import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

const COLLECTION_NAME = 'customers';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const name = searchParams.get('name');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    // If 'name' is provided, we assume this is a public verification request
    // We should mask sensitive data and return only matches
    if (name) {
      // Fetch all to filter by name (Firestore partial search limitation)
      // Note: Ideally we'd use a search service, but for limited dataset this is fine.
      const snapshot = await db.collection(COLLECTION_NAME).get();
      const allCustomers = snapshot.docs.map((doc) => ({
        id: doc.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(doc.data() as any),
      }));

      const filtered = allCustomers.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c.name && c.name.toLowerCase().includes(name.toLowerCase())
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const masked = filtered.map((c: any) => ({
        id: c.id,
        name: c.name,
        // Sensitive Data Masked but useful for verification
        phoneNumber: c.phoneNumber
          ? c.phoneNumber.replace(/\D/g, '').slice(-8)
          : '***',
        deliveryAddress: '***',
        gpsCoordinates: '***',
        userId: '***',
        // Public/Required Data
        credits: c.credits, // Allow undefined to detect new game users
        createdAt: c.createdAt,
      }));

      return withCors(NextResponse.json(masked), origin);
    }

    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const customers = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    return withCors(NextResponse.json(customers), origin);
  } catch (error) {
    console.error('Error fetching customers:', error);
    return withCors(
      NextResponse.json(
        { error: 'Failed to fetch customers' },
        { status: 500 }
      ),
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
    console.error('Error adding customer:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to add customer' }, { status: 500 }),
      origin
    );
  }
}
