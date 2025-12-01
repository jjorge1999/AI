import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

const COLLECTION_NAME = 'activityLogs';

export async function POST() {
  try {
    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Query logs older than 30 days
    const snapshot = await db.collection(COLLECTION_NAME)
      .where('timestamp', '<', thirtyDaysAgo)
      .get();
    
    // Delete in batches
    const batch = db.batch();
    let deleteCount = 0;
    
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
      deleteCount++;
    });
    
    await batch.commit();
    
    return NextResponse.json({ 
      message: 'Cleanup completed successfully',
      deletedCount: deleteCount 
    });
  } catch (error) {
    console.error('Error cleaning up logs:', error);
    return NextResponse.json({ error: 'Failed to cleanup logs' }, { status: 500 });
  }
}
