import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const targetUserId = 'admin-1';
    const collections = [
      'products',
      'sales',
      'expenses',
      'customers',
      'activityLogs',
      'messages',
    ];
    const results: Record<string, any> = {};

    for (const collectionName of collections) {
      const snapshot = await db.collection(collectionName).get();
      let count = 0;
      let totalDocs = snapshot.size;

      const batchSize = 500;
      let batch = db.batch();
      let operations = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.userId !== targetUserId) {
          batch.update(doc.ref, { userId: targetUserId });
          operations++;
          count++;
        }

        if (operations >= batchSize) {
          await batch.commit();
          batch = db.batch();
          operations = 0;
        }
      }

      if (operations > 0) {
        await batch.commit();
      }

      results[collectionName] = {
        totalDocuments: totalDocs,
        updatedDocuments: count,
      };
    }

    return NextResponse.json({
      success: true,
      message: 'Migration completed successfully',
      details: results,
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
