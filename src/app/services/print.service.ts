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

  // Comprehensive Bluetooth printer service UUIDs for major brands
  private readonly PRINTER_SERVICE_UUIDS = [
    // === Standard Bluetooth Profiles ===
    '00001101-0000-1000-8000-00805f9b34fb', // Serial Port Profile (SPP) - Universal

    // === Zebra (ZQ Series) ===
    '38eb4a80-c570-11e3-9507-0002a5d5c51b', // Zebra BLE Parser Service

    // === Goojprt / PT-210 / Generic Chinese Thermal ===
    '000018f0-0000-1000-8000-00805f9b34fb', // Battery/Generic Service
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // PT-210 Printer Service

    // === ISSC / Microchip (used by many brands) ===
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC UART Service

    // === Common BLE UART Services ===
    '0000ff00-0000-1000-8000-00805f9b34fb', // Generic Printer Service
    '0000ffe0-0000-1000-8000-00805f9b34fb', // Common BLE UART (Xprinter, Munbyn, Netum)
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service (NUS)

    // === Star Micronics ===
    '00001101-0000-1000-8000-00805f9b34fb', // Star uses SPP

    // === Bixolon SPP Series ===
    // Uses standard SPP UUID (00001101...)

    // === Brother RuggedJet ===
    // Uses standard SPP UUID (00001101...)

    // === HPRT / Cashino ===
    '0000fff0-0000-1000-8000-00805f9b34fb', // HPRT Custom Service

    // === Rongta / Milestone / Phomemo ===
    '0000ae00-0000-1000-8000-00805f9b34fb', // Common Chinese Printer Service
    '0000fee7-0000-1000-8000-00805f9b34fb', // Phomemo/Niimbot Service
  ];

  // Comprehensive write characteristic UUIDs for thermal printers
  private readonly WRITE_CHARACTERISTIC_UUIDS = [
    // === Zebra BLE ===
    '38eb4a81-c570-11e3-9507-0002a5d5c51b', // Zebra BLE Parser Characteristic

    // === Goojprt / PT-210 ===
    '00002af1-0000-1000-8000-00805f9b34fb', // PT-210 Write Characteristic
    'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', // PT-210 Alternative

    // === ISSC UART TX (Xprinter, Munbyn, many Chinese brands) ===
    '49535343-8841-43f4-a8d4-ecbe34729bb3', // ISSC UART TX

    // === Common BLE UART TX ===
    '0000ff02-0000-1000-8000-00805f9b34fb', // Generic Write
    '0000ffe1-0000-1000-8000-00805f9b34fb', // Common BLE UART TX (Most popular)
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART TX
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART RX (some use for write)

    // === HPRT / Cashino ===
    '0000fff2-0000-1000-8000-00805f9b34fb', // HPRT Write Characteristic

    // === Rongta / Milestone ===
    '0000ae01-0000-1000-8000-00805f9b34fb', // Write Characteristic
    '0000ae02-0000-1000-8000-00805f9b34fb', // Alternative Write

    // === Phomemo / Niimbot ===
    '0000fee7-0000-1000-8000-00805f9b34fb', // Phomemo Write
    '0000fec7-0000-1000-8000-00805f9b34fb', // Alternative
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
   * Scan and connect to ANY Bluetooth printer
   * Uses dynamic service discovery to support all ESC/POS compatible printers
   */
  async connectPrinter(): Promise<boolean> {
    if (!this.isBluetoothSupported()) {
      throw new Error('Web Bluetooth API is not supported in this browser');
    }

    this.connectionStatusSubject.next('connecting');

    try {
      const bluetooth = (navigator as any).bluetooth;

      // Accept ALL devices and request access to ALL possible printer services
      this.device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: this.PRINTER_SERVICE_UUIDS,
      });

      if (!this.device) {
        throw new Error('No device selected');
      }

      console.log('Selected device:', this.device.name || 'Unknown Device');

      this.device.addEventListener(
        'gattserverdisconnected',
        this.onDisconnected.bind(this)
      );

      const server = await this.device.gatt?.connect();
      if (!server) {
        throw new Error('Failed to connect to GATT server');
      }

      // Get ALL primary services (not just the ones we specified)
      let services: any[] = [];
      try {
        services = await server.getPrimaryServices();
      } catch (err) {
        console.warn('Could not get all services, trying known UUIDs...', err);
        // Fallback: Try to get services by known UUIDs
        for (const uuid of this.PRINTER_SERVICE_UUIDS) {
          try {
            const service = await server.getPrimaryService(uuid);
            services.push(service);
          } catch {
            // Service not available on this device
          }
        }
      }

      console.log(
        'Discovered services:',
        services.map((s: any) => s.uuid)
      );

      // First pass: Try to find a known write characteristic
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          console.log(
            `Service ${service.uuid} characteristics:`,
            characteristics.map((c: any) => ({
              uuid: c.uuid,
              write: c.properties.write,
              writeNoResp: c.properties.writeWithoutResponse,
            }))
          );

          // Prioritize known PT-210 characteristics
          for (const char of characteristics) {
            const charUuid = char.uuid.toLowerCase();
            if (
              this.WRITE_CHARACTERISTIC_UUIDS.some((uuid) =>
                charUuid.includes(uuid.toLowerCase())
              )
            ) {
              console.log('Found known write characteristic:', charUuid);
              this.characteristic = char;
              break;
            }
          }
          if (this.characteristic) break;
        } catch (err) {
          console.log(
            'Error getting characteristics for service',
            service.uuid,
            err
          );
        }
      }

      // Second pass: If no known characteristic found, use any writable one
      if (!this.characteristic) {
        console.log(
          'No known characteristic found, searching for any writable...'
        );
        for (const service of services) {
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (
                char.properties.write ||
                char.properties.writeWithoutResponse
              ) {
                console.log(
                  'Using fallback writable characteristic:',
                  char.uuid
                );
                this.characteristic = char;
                break;
              }
            }
            if (this.characteristic) break;
          } catch {
            // Continue to next service
          }
        }
      }

      if (!this.characteristic) {
        throw new Error(
          'No writable characteristic found on printer. Please ensure the printer is turned on and in pairing mode.'
        );
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
