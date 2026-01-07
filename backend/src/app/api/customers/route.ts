import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import { Customer } from '@/lib/models';

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
    const storeId = searchParams.get('storeId');
    const phoneNumber = searchParams.get('phoneNumber');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    // Filter by phone number if provided (exact match)
    if (phoneNumber) {
      query = query.where('phoneNumber', '==', phoneNumber);
    }

    // If 'name' is provided, we assume this is a public verification request
    if (name) {
      const snapshot = await db.collection(COLLECTION_NAME).get();
      const allCustomers = snapshot.docs.map((doc) => ({
        ...(doc.data() as Customer),
        id: doc.id,
      }));

      const filtered = allCustomers.filter((c: Customer) =>
        c.name?.toLowerCase().includes(name.toLowerCase())
      );

      const masked = filtered.map((c: Customer) => ({
        id: c.id,
        name: c.name,
        phoneNumber: c.phone ? c.phone.replaceAll(/\D/g, '').slice(-8) : '***',
        deliveryAddress: '***',
        gpsCoordinates: '***',
        userId: '***',
        credits: c.credits, // Allow credits if present
        createdAt: c.createdAt,
      }));

      return withCors(NextResponse.json(masked), origin);
    }

    if (storeId) {
      query = query.where('storeId', '==', storeId);
    } else if (userId) {
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
