import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';
import { ActivityLog } from '@/lib/models';

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
    const limit = Number.parseInt(searchParams.get('limit') || '100');

    const userId = searchParams.get('userId');
    const storeId = searchParams.get('storeId');

    let query: FirebaseFirestore.Query = db.collection(COLLECTION_NAME);

    if (storeId) {
      query = query.where('storeId', '==', storeId);
    } else if (userId) {
      query = query.where('userId', '==', userId);
    }

    if (entityType) {
      query = query.where('entityType', '==', entityType);
    }

    if (action) {
      query = query.where('action', '==', action);
    }

    query = query.limit(limit);

    const snapshot = await query.get();
    const logs = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ActivityLog[];

    // Sort in memory to avoid composite index requirement
    logs.sort((a, b) => {
      const tsA = a.timestamp as any;
      const tsB = b.timestamp as any;

      const dateA = tsA?._seconds
        ? new Date(tsA._seconds * 1000)
        : new Date(tsA as string | number | Date);
      const dateB = tsB?._seconds
        ? new Date(tsB._seconds * 1000)
        : new Date(tsB as string | number | Date);
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
