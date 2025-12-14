import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

const COLLECTION_NAME = 'users';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return withCors(
        NextResponse.json(
          { error: 'Username and password required' },
          { status: 400 }
        ),
        origin
      );
    }

    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('username', '==', username)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return withCors(
        NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
        origin
      );
    }

    const doc = snapshot.docs[0];
    const user = doc.data();

    // Verify Password (Hash Comparison)
    // The client sends the HASH of the password. The DB stores the HASH of the password.
    if (user.password !== password) {
      return withCors(
        NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }),
        origin
      );
    }

    // Return User WITHOUT password (Secure)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...safeUser } = user;

    return withCors(
      NextResponse.json({
        id: doc.id,
        ...safeUser,
      }),
      origin
    );
  } catch (error) {
    console.error('Error logging in:', error);
    return withCors(
      NextResponse.json({ error: 'Internal Server Error' }, { status: 500 }),
      origin
    );
  }
}
