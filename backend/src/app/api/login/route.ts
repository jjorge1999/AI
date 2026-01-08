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

    // Check Account Expiration
    if (user.role !== 'super-admin' && user.accessExpiryDate) {
      const now = new Date();
      let expiryDate = new Date(user.accessExpiryDate);

      // Handle Firebase Timestamp
      const expiry = user.accessExpiryDate as { _seconds?: number };
      if (expiry && typeof expiry._seconds === 'number') {
        expiryDate = new Date(expiry._seconds * 1000);
      }

      // Set expiry to end of day to be generous
      expiryDate.setHours(23, 59, 59, 999);

      if (now > expiryDate) {
        return withCors(
          NextResponse.json(
            { error: `Account expired on ${expiryDate.toLocaleDateString()}` },
            { status: 403 }
          ),
          origin
        );
      }
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
  } catch (error: unknown) {
    const err = error as any;
    console.error('Error logging in:', err);

    // Detect quota errors or database not found (Project ID mismatch)
    const isQuotaError =
      err.code === 8 ||
      err.code === 'resource-exhausted' ||
      (err.message && err.message.toLowerCase().includes('quota'));

    const isNotFound =
      err.code === 5 || (err.message && err.message.includes('NOT_FOUND'));

    return withCors(
      NextResponse.json(
        {
          error: isQuotaError
            ? 'Firebase Quota Exhausted'
            : isNotFound
            ? 'Database/Project Not Found'
            : 'Internal Server Error',
          details: err instanceof Error ? err.message : String(err),
          code: err.code,
        },
        { status: isQuotaError ? 429 : isNotFound ? 404 : 500 }
      ),
      origin
    );
  }
}
