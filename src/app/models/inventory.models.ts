export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  createdAt: Date;
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
}

export interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
  deliveryAddress: string;
  createdAt: Date;
}

export interface Expense {
  id: string;
  productName: string;
  price: number;
  notes?: string;
  timestamp: Date;
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
