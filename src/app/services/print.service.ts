import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  orderId: string;
  date: Date;
  items: {
    name: string;
    quantity: number;
    price: number;
    discount?: number;
    discountType?: 'amount' | 'percent';
    total: number;
  }[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  cashReceived: number;
  change: number;
  customerName?: string;
  deliveryDate?: Date;
  notes?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PrintService {
  private device: any = null;
  private characteristic: any = null;

  private connectionStatusSubject = new BehaviorSubject<
    'disconnected' | 'connecting' | 'connected'
  >('disconnected');
  public connectionStatus$ = this.connectionStatusSubject.asObservable();

  private deviceNameSubject = new BehaviorSubject<string | null>(null);
  public deviceName$ = this.deviceNameSubject.asObservable();

  // Common Bluetooth printer service UUIDs
  private readonly PRINTER_SERVICE_UUIDS = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  ];

  constructor() {
    const savedPrinter = localStorage.getItem('jjm_bluetooth_printer');
    if (savedPrinter) {
      this.deviceNameSubject.next(savedPrinter);
    }
  }

  /**
   * Check if Web Bluetooth API is available
   */
  isBluetoothSupported(): boolean {
    return !!(navigator as any).bluetooth;
  }

  /**
   * Scan and connect to a Bluetooth printer
   */
  async connectPrinter(): Promise<boolean> {
    if (!this.isBluetoothSupported()) {
      throw new Error('Web Bluetooth API is not supported in this browser');
    }

    this.connectionStatusSubject.next('connecting');

    try {
      const bluetooth = (navigator as any).bluetooth;
      this.device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.PRINTER_SERVICE_UUIDS,
      });

      if (!this.device) {
        throw new Error('No device selected');
      }

      this.device.addEventListener(
        'gattserverdisconnected',
        this.onDisconnected.bind(this)
      );

      const server = await this.device.gatt?.connect();
      if (!server) {
        throw new Error('Failed to connect to GATT server');
      }

      const services = await server.getPrimaryServices();
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              break;
            }
          }
          if (this.characteristic) break;
        } catch {
          // Continue to next service
        }
      }

      if (!this.characteristic) {
        throw new Error('No writable characteristic found on printer');
      }

      const printerName = this.device.name || 'Bluetooth Printer';
      localStorage.setItem('jjm_bluetooth_printer', printerName);
      this.deviceNameSubject.next(printerName);
      this.connectionStatusSubject.next('connected');

      return true;
    } catch (error) {
      console.error('Bluetooth connection error:', error);
      this.connectionStatusSubject.next('disconnected');
      throw error;
    }
  }

  /**
   * Disconnect from the printer
   */
  disconnectPrinter(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.characteristic = null;
    this.connectionStatusSubject.next('disconnected');
  }

  private onDisconnected(): void {
    this.characteristic = null;
    this.connectionStatusSubject.next('disconnected');
  }

  /**
   * Send raw data to printer
   */
  private async sendData(data: Uint8Array): Promise<void> {
    if (!this.characteristic) {
      throw new Error('Printer not connected');
    }

    const chunkSize = 100;
    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(chunk);
      } else {
        await this.characteristic.writeValue(chunk);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // ESC/POS command constants
  private ESC = 0x1b;
  private GS = 0x1d;
  private LF = 0x0a;

  private buildEscPosReceipt(data: ReceiptData): Uint8Array {
    const encoder = new TextEncoder();
    const commands: number[] = [];

    // Helper to add bytes
    const add = (...bytes: number[]) => {
      for (const b of bytes) commands.push(b);
    };
    const addText = (text: string) => {
      const encoded = encoder.encode(text);
      for (let i = 0; i < encoded.length; i++) {
        commands.push(encoded[i]);
      }
    };

    // Initialize printer
    add(this.ESC, 0x40);

    // Center align for header
    add(this.ESC, 0x61, 0x01);

    // Double width/height for store name
    add(this.ESC, 0x21, 0x30);
    addText(data.storeName);
    add(this.LF);

    // Normal size
    add(this.ESC, 0x21, 0x00);

    if (data.storeAddress) {
      addText(data.storeAddress);
      add(this.LF);
    }
    if (data.storePhone) {
      addText(`Tel: ${data.storePhone}`);
      add(this.LF);
    }

    addText('================================');
    add(this.LF);

    addText(`Order: ${data.orderId}`);
    add(this.LF);
    addText(
      `Date: ${data.date.toLocaleDateString()} ${data.date.toLocaleTimeString()}`
    );
    add(this.LF);

    if (data.customerName) {
      addText(`Customer: ${data.customerName}`);
      add(this.LF);
    }

    if (data.deliveryDate) {
      addText(
        `Delivery: ${data.deliveryDate.toLocaleDateString()} ${data.deliveryDate.toLocaleTimeString()}`
      );
      add(this.LF);
    }

    addText('--------------------------------');
    add(this.LF);

    // Left align for items
    add(this.ESC, 0x61, 0x00);

    for (const item of data.items) {
      addText(item.name);
      add(this.LF);

      const qtyLine = `  ${item.quantity} x ${this.formatMoney(item.price)}`;
      const totalStr = this.formatMoney(item.total);
      const padding = 32 - qtyLine.length - totalStr.length;
      addText(qtyLine + ' '.repeat(Math.max(1, padding)) + totalStr);
      add(this.LF);

      if (item.discount && item.discount > 0) {
        const discStr =
          item.discountType === 'percent'
            ? `  Discount: ${item.discount}%`
            : `  Discount: -${this.formatMoney(item.discount)}`;
        addText(discStr);
        add(this.LF);
      }
    }

    addText('--------------------------------');
    add(this.LF);

    // Right align totals
    add(this.ESC, 0x61, 0x02);

    if (data.totalDiscount > 0) {
      addText(`Total Discount: -${this.formatMoney(data.totalDiscount)}`);
      add(this.LF);
    }

    // Bold for total
    add(this.ESC, 0x45, 0x01);
    addText(`TOTAL: ${this.formatMoney(data.total)}`);
    add(this.LF);
    add(this.ESC, 0x45, 0x00);

    addText(`Cash: ${this.formatMoney(data.cashReceived)}`);
    add(this.LF);
    addText(`Change: ${this.formatMoney(data.change)}`);
    add(this.LF);

    if (data.notes) {
      add(this.ESC, 0x61, 0x00);
      addText('--------------------------------');
      add(this.LF);
      addText(`Notes: ${data.notes}`);
      add(this.LF);
    }

    // Footer
    add(this.ESC, 0x61, 0x01);
    addText('================================');
    add(this.LF);
    addText('Thank you for your purchase!');
    add(this.LF);
    addText('Please come again');
    add(this.LF, this.LF, this.LF);

    // Cut paper
    add(this.GS, 0x56, 0x01);

    return new Uint8Array(commands);
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
    }).format(value);
  }

  /**
   * Print a receipt
   */
  async printReceipt(data: ReceiptData): Promise<void> {
    const receiptData = this.buildEscPosReceipt(data);
    await this.sendData(receiptData);
  }

  /**
   * Print a test page
   */
  async printTestPage(): Promise<void> {
    const testData: ReceiptData = {
      storeName: 'JJM Inventory',
      storeAddress: 'Test Address',
      storePhone: '123-456-7890',
      orderId: 'TEST-001',
      date: new Date(),
      items: [
        { name: 'Test Product 1', quantity: 2, price: 100, total: 200 },
        { name: 'Test Product 2', quantity: 1, price: 150, total: 150 },
      ],
      subtotal: 350,
      totalDiscount: 0,
      total: 350,
      cashReceived: 500,
      change: 150,
    };

    await this.printReceipt(testData);
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return (
      this.connectionStatusSubject.value === 'connected' &&
      this.characteristic !== null
    );
  }

  /**
   * Forget saved printer
   */
  forgetPrinter(): void {
    localStorage.removeItem('jjm_bluetooth_printer');
    this.deviceNameSubject.next(null);
    this.disconnectPrinter();
  }
}
