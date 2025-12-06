export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  createdAt: Date;
  userId?: string;
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
  timestamp: Date;
  deliveryDate?: Date;
  deliveryNotes?: string;
  customerId?: string;
  pending?: boolean; // true if sale is pending delivery
  discount?: number;
  discountType?: 'amount' | 'percent';
  userId?: string;
}

export interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
  deliveryAddress: string;
  createdAt: Date;
  userId?: string;
}

export interface Expense {
  id: string;
  productName: string;
  price: number;
  notes?: string;
  timestamp: Date;
  userId?: string;
}

export interface ActivityLog {
  id: string;
  action: string; // 'create', 'update', 'delete', 'restock', 'complete'
  entityType: string; // 'product', 'sale', 'expense', 'customer'
  entityId: string;
  entityName: string;
  details?: string;
  timestamp: Date;
  userId?: string;
}

export interface Message {
  id: string;
  text: string;
  senderName: string;
  timestamp: Date;
  userId?: string;
  conversationId?: string;
  audioBase64?: string;
}

export interface WebRTCCall {
  id: string;
  conversationId: string;
  callerName: string;
  status: 'offering' | 'answered' | 'ended' | 'rejected';
  offer?: any;
  answer?: any;
  timestamp: Date;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  password?: string; // Optional for display, required for auth
  role: 'admin' | 'user';
  createdAt: Date;
  createdBy?: string;
  userId?: string;
}
