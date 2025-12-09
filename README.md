# JJM Inventory

A comprehensive Inventory Management and Point of Sale (POS) system built with a modern web stack. This application integrates inventory tracking, sales processing, real-time chat, and activity logging into a unified platform.

## 🚀 Features

- **Inventory Management**: Track products, stock levels, and pricing with real-time updates.
- **Point of Sale (POS)**:
  - Integrated sales calculator.
  - **Pending Deliveries**: Manage scheduled deliveries, track overdue items, and handle stock deduction upon delivery confirmation.
  - **Reservations**: Create and manage product reservations for customers.
- **Financial Tracking**: Record sales, expenses, and view profit/loss reports.
- **Activity Logging**: Comprehensive audit log tracking all secure user actions (CREATE, UPDATE, DELETE).
- **Communication Hub**:
  - **Chat**: Integrated customer support chat with real-time messaging.
  - **Calls**: WebRTC-based audio calls for direct communication.
- **User Management**: Admin tools for managing app users and customers.
- **Mobile Ready**: Optimized for mobile browsers and Android deployment via Capacitor.

## 🛠️ Tech Stack

### Frontend

- **Framework**: Angular 17
- **Styling**: Modern CSS Variables & Responsive Design
- **Real-time**: Firebase Firestore (Live Listeners)
- **Audio/Calls**: WebRTC
- **Mobile**: Capacitor

### Backend

- **Framework**: Next.js 16 (API Routes)
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth & Custom Logic

## 📋 Prerequisites

Ensure you have the following installed on your local machine:

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [npm](https://www.npmjs.com/)
- [Angular CLI](https://angular.io/cli): `npm install -g @angular/cli`

## ⚙️ Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd jjm-inventory
    ```

2.  **Install Frontend Dependencies:**

    ```bash
    npm install
    ```

3.  **Install Backend Dependencies:**
    Navigate to the backend directory and install its dependencies.
    ```bash
    cd backend
    npm install
    ```

## 🏃‍♂️ Running the Application

To run the full application, you need to start the Next.js API server and the Angular frontend.

### Quick Start (Recommended)

Run both servers with a single command from the root directory:

```bash
npm run dev
```

This will start:

- **Frontend** on `http://localhost:4200/`
- **Backend API** on `http://localhost:3000`

### Manual Start

#### 1. Start the Backend API

```bash
cd backend
npm run dev
```

#### 2. Start the Frontend Application

Open a new terminal window:

```bash
# From the root directory
npm start
```

## 📂 Project Structure

- **`/src/app/components`**: Core application features (POS, Inventory, Chat, Reports, Activity Logs, etc.).
- **`/src/app/services`**: Logic layers handling API calls and Firebase interaction (InventoryService, ChatService, etc.).
- **`/backend`**: Next.js API routes serving as the backend logic layer.
- **`/android`**: Android project files for mobile build.

## 📱 Mobile Build (Android)

To build the project for Android:

```bash
npm run apk:release
```

_This command builds the web assets, copies them to the Android project, and assembles the release APK._

## 🤝 Contributing

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/amazing-feature`).
3.  Commit your changes (`git commit -m 'Add some amazing feature'`).
4.  Push to the branch (`git push origin feature/amazing-feature`).
5.  Open a Pull Request.
