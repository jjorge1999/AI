import * as admin from 'firebase-admin';

// --- MOCK DB IMPLEMENTATION ---

class MockQuery {
  private data: any[];

  constructor(data: any[]) {
    this.data = data;
  }

  where(field: string, op: string, value: any): MockQuery {
    const filtered = this.data.filter((item) => {
      if (op === '==') return item[field] === value;
      if (op === '>') return item[field] > value;
      if (op === '<') return item[field] < value;
      if (op === '>=') return item[field] >= value;
      if (op === '<=') return item[field] <= value;
      if (op === 'array-contains')
        return Array.isArray(item[field]) && item[field].includes(value);
      return true;
    });
    return new MockQuery(filtered);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): MockQuery {
    const sorted = [...this.data].sort((a, b) => {
      if (a[field] < b[field]) return direction === 'asc' ? -1 : 1;
      if (a[field] > b[field]) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return new MockQuery(sorted);
  }

  limit(count: number): MockQuery {
    return new MockQuery(this.data.slice(0, count));
  }

  async get(): Promise<MockQuerySnapshot> {
    return new MockQuerySnapshot(this.data);
  }
}

class MockQuerySnapshot {
  docs: MockQueryDocumentSnapshot[];
  empty: boolean;
  size: number;

  constructor(data: any[]) {
    this.docs = data.map((item) => new MockQueryDocumentSnapshot(item));
    this.empty = this.docs.length === 0;
    this.size = this.docs.length;
  }
}

class MockQueryDocumentSnapshot {
  id: string;
  private _data: any;

  constructor(data: any) {
    this.id = data.id;
    this._data = data;
  }

  data() {
    return this._data;
  }
}

class MockCollectionReference {
  private name: string;
  private db: MockFirestore;

  constructor(name: string, db: MockFirestore) {
    this.name = name;
    this.db = db;
  }

  doc(id?: string): MockDocumentReference {
    return new MockDocumentReference(this.name, id, this.db);
  }

  async add(data: any): Promise<MockDocumentReference> {
    const id = Math.random().toString(36).substring(7);
    const docRef = this.doc(id);
    await docRef.set(data);
    return docRef;
  }

  where(field: string, op: string, value: any): MockQuery {
    const allDocs = this.db._getCollectionData(this.name);
    return new MockQuery(allDocs).where(field, op, value);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): MockQuery {
    const allDocs = this.db._getCollectionData(this.name);
    return new MockQuery(allDocs).orderBy(field, direction);
  }

  async get(): Promise<MockQuerySnapshot> {
    const allDocs = this.db._getCollectionData(this.name);
    return new MockQuerySnapshot(allDocs);
  }
}

class MockDocumentReference {
  private collectionName: string;
  id: string;
  private db: MockFirestore;

  constructor(collectionName: string, id: string | undefined, db: MockFirestore) {
    this.collectionName = collectionName;
    this.id = id || Math.random().toString(36).substring(7);
    this.db = db;
  }

  async set(data: any, options?: any): Promise<void> {
    this.db._setDoc(this.collectionName, this.id, { ...data, id: this.id });
  }

  async update(data: any): Promise<void> {
    const current = this.db._getDoc(this.collectionName, this.id);
    if (current) {
      this.db._setDoc(this.collectionName, this.id, { ...current, ...data });
    }
  }

  async delete(): Promise<void> {
    this.db._deleteDoc(this.collectionName, this.id);
  }

  async get(): Promise<MockQueryDocumentSnapshot> {
    const data = this.db._getDoc(this.collectionName, this.id);
    // Mimic behavior where if doc doesn't exist, exists is false (simplified here)
    if (!data) return { exists: false, data: () => undefined, id: this.id } as any;
    return new MockQueryDocumentSnapshot(data);
  }
}

class MockFirestore {
  private storage: { [collection: string]: { [id: string]: any } } = {};

  constructor() {
    this.seed();
  }

  private async seed() {
      // Seed Admin User
      // Hashed password for 'Gr*l0v3R' (SHA-256)
      // generated with crypto.subtle.digest in browser, or node crypto
      // echo -n "Gr*l0v3R" | sha256sum
      // 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
      this._setDoc('users', 'admin-1', {
          id: 'admin-1',
          username: 'jjm143256789',
          fullName: 'System Administrator',
          password: '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4',
          role: 'admin',
          createdAt: new Date().toISOString()
      });

      console.log('Mock DB Seeded with Admin User');
  }

  collection(name: string): MockCollectionReference {
    return new MockCollectionReference(name, this);
  }

  _setDoc(collection: string, id: string, data: any) {
    if (!this.storage[collection]) {
      this.storage[collection] = {};
    }
    this.storage[collection][id] = data;
  }

  _getDoc(collection: string, id: string) {
    return this.storage[collection]?.[id];
  }

  _deleteDoc(collection: string, id: string) {
    if (this.storage[collection]) {
      delete this.storage[collection][id];
    }
  }

  _getCollectionData(collection: string) {
    if (!this.storage[collection]) return [];
    return Object.values(this.storage[collection]);
  }
}

// --- END MOCK DB ---

let db: any; // Type as any to allow MockFirestore or FirebaseFirestore

// Check if credentials exist
const hasCredentials = process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL;

if (hasCredentials) {
    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Replace escaped newlines with actual newlines
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          }),
        });
        console.log('Firebase Admin Initialized');
      } catch (error) {
        console.error('Firebase Admin Initialization Error:', error);
      }
    }
    db = admin.firestore();
} else {
    console.warn('WARNING: Firebase Environment Variables Missing. Using In-Memory Mock Database.');
    db = new MockFirestore();
}

export { db };
