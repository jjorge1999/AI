import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

const COLLECTION_NAME = 'activityLogs';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');
    const limit = parseInt(searchParams.get('limit') || '100');

    const userId = searchParams.get('userId');

    let query = db.collection(COLLECTION_NAME);

    if (userId) {
      query = query.where('userId', '==', userId) as any;
    }

    if (entityType) {
      query = query.where('entityType', '==', entityType) as any;
    }

    if (action) {
      query = query.where('action', '==', action) as any;
    }

    query = query.limit(limit) as any;

    const snapshot = await query.get();
    const logs: any[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Sort in memory to avoid composite index requirement
    logs.sort((a, b) => {
      const dateA = a.timestamp?._seconds
        ? new Date(a.timestamp._seconds * 1000)
        : new Date(a.timestamp);
      const dateB = b.timestamp?._seconds
        ? new Date(b.timestamp._seconds * 1000)
        : new Date(b.timestamp);
      return dateB.getTime() - dateA.getTime();
    });

    return withCors(NextResponse.json(logs), origin);
  } catch (error) {
    console.error('Error fetching logs:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 }),
      origin
    );
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const body = await request.json();

    const logData = {
      ...body,
      timestamp: new Date(),
    };

    const docRef = await db.collection(COLLECTION_NAME).add(logData);

    return withCors(
      NextResponse.json({ id: docRef.id, ...logData }, { status: 201 }),
      origin
    );
  } catch (error) {
    console.error('Error creating log:', error);
    return withCors(
      NextResponse.json({ error: 'Failed to create log' }, { status: 500 }),
      origin
    );
  }
}
