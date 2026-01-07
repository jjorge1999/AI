export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  minQuantity: number;
  imageUrl?: string;
  createdAt: Date | string; // Firestore returns Timestamp, need to handle
  storeId?: string;
}

export interface Store {
  id: string;
  name: string;
  address?: string;
  phoneNumber?: string;
  isActive?: boolean;
  isSuperAdminOnly?: boolean;
  createdAt: Date | string;
  createdBy?: string;
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  category: string;
  price: number;
  quantitySold: number;
  total: number;
  cashReceived: number;
  change: number;
  timestamp: Date | string;
  deliveryDate?: Date | string;
  deliveryNotes?: string;
  pending?: boolean;
  discount?: number;
  discountType?: 'amount' | 'percent';
  storeId?: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  timestamp: Date | string;
  storeId?: string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  credits?: number;
  createdAt: Date | string;
  storeId?: string;
}

export interface Message {
  id: string;
  text: string;
  senderName: string;
  timestamp: Date | string;
  userId?: string;
  storeId?: string;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  password?: string;
  role: 'super-admin' | 'admin' | 'user';
  createdAt: Date | string;
  storeId?: string; // Current associated store
  storeIds?: string[]; // Multiple stores for admins
}

export interface ActivityLog {
  id: string;
  userId?: string;
  username?: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: string;
  timestamp: Date | string | { _seconds: number; _nanoseconds: number };
  storeId?: string;
}
