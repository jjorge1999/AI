# 📖 JJM Inventory System - User Manual

Welcome to the **JJM Inventory Application**!  
This guide handles everything you need to know to operate the system effectively, whether you are a cashier, store manager, or administrator.

---

## 🚀 1. Getting Started

### Accessing the System

- **Login Page**: Accessible at `/login`.
- **Credentials**: Enter your assigned **Username** and **Password**.
- **Store Assignment**: The system automatically detects which store you belong to. If you manage multiple stores, check the dashboard top-bar to confirm your active location.

### The Dashboard (`/home`)

Once logged in, you will land on the Dashboard. This is your command center showing:

- **Quick Stats**: Daily sales summary.
- **Pending Actions**: Any deliveries or alerts requiring immediate attention.
- **Navigation Menu**: Use the sidebar to jump to POS, Inventory, or Reports.

---

## 🛒 2. Front Desk Operations

### 💵 Point of Sale (POS)

Navigate to **Sell** (`/sell`) to process transactions.

**How to Process a Sale:**

1.  **Add Items**:
    - Tap product cards on the screen to add them to the cart.
    - Use the **Search Bar** to find specific items by name.
    - _Quantity_: Tap an item in the cart to adjust quantity or remove it.
2.  **Apply Discounts** (Optional):
    - Select a cart item or the total bill.
    - Choose **Percentage (%)** or **Fixed Amount ($)** discount.
3.  **Select Customer** (Optional):
    - For tracking loyalty points, select an existing customer from the dropdown.
4.  **Checkout**:
    - **Cash Payment**: Enter the amount received. The system calculates change automatically.
    - **Schedule Delivery**: If the customer wants it delivered later, select **"Delivery"**. You will be prompted to set a **Date** and **Time**.

### � Delivery Management

The POS screen includes a **"Pending Deliveries"** panel.

- **Status Colors**:
  - 🟢 **Green**: Scheduled for future.
  - 🔴 **Red**: Overdue! Action required immediately.
- **Actions**:
  - **Print Receipt**: Click the Printer icon 🖨️ to generate a delivery slip.
  - **Confirm**: When the driver leaves or returns, mark the order as "Delivered" to deduct stock.

### 💬 Chat & Support

- Navigate to **Chat** to communicate with customers.
- **Features**:
  - Text messaging.
  - **Voice Call**: Click the phone icon 📞 to start a secure WebRTC call with the customer.

---

## 🎮 3. Kiosk & Self-Service Features

These pages are designed to be loaded on a public tablet or kiosk screen for customers.

### 🎰 The Color Game (`/play`)

A customer loyalty experience.

- **Verification**: Customers enter their verified Name/Phone to access their account.
- **Daily Bonus**: Logging in grants free playing credits once per day.
- **Gameplay**: Customers bet credits on colors. Winning rolls increase their credit balance, which they can redeem for store discounts.

### 🍽️ Self-Service Reservations (`/reservation`)

Allows customers to place orders themselves.

- **Catalog**: Customers browse your available inventory.
- **Booking**: They select items and a pickup slot.
- **Ads Bar**: The top of the screen displays your active **Ad Campaigns** automatically.

---

## � 4. Manager's Office (Admin)

### 📦 Inventory Control

Navigate to **Inventory**.

- **Add Product**: Click **"+ Add Item"**. Fill in Name, Price, Cost, and Stock Level.
- **Low Stock Alerts**: Items below the threshold will be highlighted.
- **Editing**: Click any row to update prices or stock counts.

### 📢 Marketing & Ads (`/ads`)

Control what customers see on the Kiosk screens.

- **Campaigns**: Create "Video" or "Image" ads.
- **AI Assistant**: When uploading an ad, click **"Generate Caption"** to let our AI write a catchy description for you.
- **Status**: Toggle ads to **Active** or **Paused** instantly.

### � Financials

- **Expenses (`/expenses`)**:
  - Log every payout (rent, utilities, supplies).
  - Categorize expenses for better reporting.
- **Reports (`/sales`)**:
  - View detailed transaction logs.
  - Analyze **Net Profit** (Sales minus Expenses).

### 🛡️ Security Audit (`/logs`)

The **Activity Log** is a security feature.

- **What it tracks**: Every sensitive action (Price changes, Stock adjustments, Logins).
- **Usage**: Check this weekly to ensure no unauthorized changes are occurring in your store.

### 👥 User & Staff Management (`/users`)

Manage who can access the system.

- **Role Management**: Assign roles like `Admin`, `Editor`, or `User`.
- **Expiration Dates**: Set an **Account Expiration Date** for temporary staff. Access will automatically be revoked after this date.
- **Store Assignment**: Link users to specific stores.

---

### ❓ Troubleshooting

- **"Store Not Loading"**: Refresh the page. Ensure you are logged in with the correct user.
- **"Printer Not Working"**: Check the print service connection in the Browser Settings.

_For further technical support, please contact the IT Department._
