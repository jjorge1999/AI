import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { withCors, corsResponse } from '@/lib/cors';

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return corsResponse(origin);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  try {
    const { storeId } = await request.json();

    if (!storeId) {
      return withCors(
        NextResponse.json({ error: 'storeId is required' }, { status: 400 }),
        origin
      );
    }

    const collections = [
      'activityLogs',
      'ads',
      'calls',
      'customers',
      'expenses',
      'messages',
      'products',
      'reservations',
      'sales',
      'sales_events',
      'settings',
      'status',
      'users',
    ];

    const results: Record<string, number> = {};

    for (const collectionName of collections) {
      const snapshot = await db.collection(collectionName).get();
      let totalMigrated = 0;

      let batch = db.batch();
      let batchCount = 0;

      for (const doc of snapshot.docs) {
        const data = doc.data();

        // Skip if already assigned or if migration not applicable (e.g. settings might be global but let's migrate if orphan)
        // For 'users', we check for missing storeId
        if (!data.storeId) {
          const updateData: any = { storeId };

          // Special case for users: ensure they also have the storeId in their storeIds array
          if (collectionName === 'users') {
            const currentStoreIds = data.storeIds || [];
            if (!currentStoreIds.includes(storeId)) {
              updateData.storeIds = [...currentStoreIds, storeId];
            }
          }

          batch.update(doc.ref, updateData);
          totalMigrated++;
          batchCount++;

          if (batchCount === 500) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      results[collectionName] = totalMigrated;
    }

    return withCors(
      NextResponse.json({
        message: 'Comprehensive migration completed successfully',
        summary: results,
      }),
      origin
    );
  } catch (error) {
    console.error('Migration error:', error);
    return withCors(
      NextResponse.json(
        { error: 'Migration failed during comprehensive processing' },
        { status: 500 }
      ),
      origin
    );
  }
}
