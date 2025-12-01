import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

const COLLECTION_NAME = 'messages';

export async function GET() {
  try {
    const snapshot = await db
      .collection(COLLECTION_NAME)
      .orderBy('timestamp', 'asc')
      .limit(100) // Get last 100 messages
      .get();

    const messages = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate
          ? data.timestamp.toDate()
          : data.timestamp,
      };
    });
    return NextResponse.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const docRef = await db.collection(COLLECTION_NAME).add({
      text: body.text,
      senderName: body.senderName,
      timestamp: new Date(),
      userId: body.userId || null,
    });

    const newMessage = {
      id: docRef.id,
      ...body,
      timestamp: new Date(),
    };

    // Broadcast to WebSocket server
    try {
      await fetch('http://localhost:3001/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage),
      });
    } catch (wsError) {
      console.error('Failed to broadcast message:', wsError);
      // Don't fail the request if broadcast fails
    }

    return NextResponse.json(newMessage, { status: 201 });
  } catch (error) {
    console.error('Error adding message:', error);
    return NextResponse.json(
      { error: 'Failed to add message' },
      { status: 500 }
    );
  }
}
