import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

const COLLECTION_NAME = 'activityLogs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');
    const limit = parseInt(searchParams.get('limit') || '100');
    
    let query = db.collection(COLLECTION_NAME).orderBy('timestamp', 'desc');
    
    if (entityType) {
      query = query.where('entityType', '==', entityType) as any;
    }
    
    if (action) {
      query = query.where('action', '==', action) as any;
    }
    
    query = query.limit(limit) as any;
    
    const snapshot = await query.get();
    const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    return NextResponse.json(logs);
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const logData = {
      ...body,
      timestamp: new Date()
    };
    
    const docRef = await db.collection(COLLECTION_NAME).add(logData);
    
    return NextResponse.json({ id: docRef.id, ...logData }, { status: 201 });
  } catch (error) {
    console.error('Error creating log:', error);
    return NextResponse.json({ error: 'Failed to create log' }, { status: 500 });
  }
}
