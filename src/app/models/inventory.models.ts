export enum SubscriptionPlans {
  FREE = 'Free',
  STARTER = 'Starter',
  PRO = 'Pro',
  ENTERPRISE = 'Enterprise',
  EARLY_ADOPTER = 'EarlyAdopter',
}

export enum NotificationTypes {
  MESSAGE = 'message',
  RESERVATION = 'reservation',
  DELIVERY = 'delivery',
  SYSTEM = 'system',
  REMINDER = 'reminder',
}

export interface RawMaterial {
  id: string;
  name: string;
  cost: number;
  userId?: string;
  storeId?: string;
  createdAt: Date;
}

export interface RecipeItem {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number; // Selling price
  cost?: number; // Cost price (for profit calculation)
  quantity: number;
  isRawMaterial?: boolean; // Flag for raw materials
  recipe?: RecipeItem[]; // Ingredients/Components
  imageUrl?: string;
  createdAt: Date;
  userId?: string;
  storeId?: string;
}

export interface Category {
  id: string;
  name: string;
  userId?: string;
  storeId?: string;
  createdAt: Date;
}

export interface Store {
  id: string;
  name: string;
  address?: string;
  phoneNumber?: string;
  isActive?: boolean;
  isSuperAdminOnly?: boolean;
  logoUrl?: string;
  description?: string;
  createdAt: Date;
  createdBy?: string;
  subscriptionPlan?: SubscriptionPlans | string;
  subscriptionExpiryDate?: Date | string;
  credits?: {
    ai: number;
    aiResponse?: number;
    transactions?: number;
    callMinutes: number;
    lastResetDate: Date;
  };
  pendingSubscription?: {
    plan: 'Free' | 'Starter' | 'Pro' | 'Enterprise';
    proofUrl: string; // Base64 or URL
    requestDate: Date;
    referenceNumber?: string;
  } | null;
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  category: string;
  price: number;
  costPrice?: number; // Unit cost at time of sale
  quantitySold: number;
  total: number;
  cashReceived: number;
  change: number;
  timestamp: Date;
  deliveryDate?: Date;
  deliveryNotes?: string;
  customerId?: string;
  customerName?: string; // For reservations
  customerContact?: string; // For reservations
  customerAddress?: string; // For reservations
  pending?: boolean; // true if sale is pending delivery
  discount?: number;
  discountType?: 'amount' | 'percent';
  userId?: string;
  storeId?: string;
  reservationStatus?: 'pending_confirmation' | 'confirmed';
  orderId?: string;
}

export interface Customer {
  id: string;
  name: string;
  phoneNumber: string;
  deliveryAddress: string;
  gpsCoordinates?: string;
  createdAt: Date;
  userId?: string;
  storeId?: string;
  credits?: number; // Added for Color Game
}

export interface Expense {
  id: string;
  productName: string;
  price: number;
  notes?: string;
  timestamp: Date;
  userId?: string;
  storeId?: string;
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
  userName?: string; // User-friendly display name
  storeId?: string;
  storeName?: string; // User-friendly store name
}

export interface Message {
  id: string;
  text: string;
  senderName: string;
  timestamp: Date;
  userId?: string;
  storeId?: string;
  conversationId?: string;
  audioBase64?: string;
  isRead?: boolean;
  sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
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
  address?: string; // Added for chat/profile info
  gpsCoordinates?: string;
  password?: string; // Optional for display, required for auth
  role: 'super-admin' | 'admin' | 'editor' | 'user';
  createdAt: Date;
  createdBy?: string;
  userId?: string;
  hasSubscription?: boolean;
  storeId?: string; // Current associated store
  storeIds?: string[]; // Multiple stores for admins
  accessExpiryDate?: Date; // Account expiration date
}

export interface Reservation {
  id?: string;
  customerName: string;
  customerContact: string;
  customerAddress?: string;
  pickupDate: Date;
  status: 'pending' | 'confirmed' | 'rejected' | 'completed';
  items: {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }[];
  totalAmount: number;
  notes?: string;
  reservationDate: Date;
  storeId?: string;
}

export interface DashboardStats {
  totalRevenue: number;
  mtdRevenue: number;
  todayRevenue: number;
  totalProfit: number;
  mtdProfit: number;
  todayProfit: number;
  todayOrdersCount: number;
  totalProductsCount: number;
  lowStockCount: number;
  lastUpdated: Date;
  storeId: string;
  topSellingProducts?: { name: string; unitsSold: number; revenue: number }[];
  categoryDistribution?: { name: string; percentage: number }[];
  recentOrders?: any[]; // Simplified for storage
  topCustomers?: { name: string; totalSpent: number; ordersCount: number }[];
}
