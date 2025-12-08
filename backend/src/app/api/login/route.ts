import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

const COLLECTION_NAME = 'users';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password required' },
        { status: 400 }
      );
    }

    const snapshot = await db
      .collection(COLLECTION_NAME)
      .where('username', '==', username)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const doc = snapshot.docs[0];
    const user = doc.data();

    // Verify Password (Hash Comparison)
    // The client sends the HASH of the password. The DB stores the HASH of the password.
    if (user.password !== password) {
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Return User WITHOUT password (Secure)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...safeUser } = user;

    return NextResponse.json({
      id: doc.id,
      ...safeUser,
    });
  } catch (error) {
    console.error('Error logging in:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
