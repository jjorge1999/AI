export interface SaleEvent {
  id?: string;
  name: string;
  month: number; // 1-12
  day: number; // 1-31
  duration: number; // days
  discount: number; // percentage
  isActive: boolean;
  holidayKeywords?: string[]; // e.g., ['lechon', 'food', 'party']
  excludeKeywords?: string[]; // e.g., ['sand', 'cement', 'holloblock']
  bannerTitle?: string; // e.g., '🎁 Christmas Sale!'
  bannerMessage?: string; // e.g., 'Celebrate Christmas with...'
  bannerIcon?: string; // e.g., '🎄'
  saleType?: 'actual' | 'psychological'; // Legacy/Default

  // Combined Strategy Fields
  isActualSale?: boolean;
  actualDiscount?: number;
  isPsychologicalSale?: boolean;
  psychologicalDiscount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}
