export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  minQuantity: number;
  imageUrl?: string;
  createdAt: Date | string; // Firestore returns Timestamp, need to handle
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
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  timestamp: Date | string;
}

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  createdAt: Date | string;
}

export interface Message {
  id: string;
  text: string;
  senderName: string;
  timestamp: Date | string;
  userId?: string;
}
