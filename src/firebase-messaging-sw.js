importScripts('https://www.gstatic.com/firebasejs/10.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDJL01CQ2KJGqni6Q3EPR8Yv1CPW6cXezk',
  authDomain: 'inventory-8b0ad.firebaseapp.com',
  projectId: 'inventory-8b0ad',
  storageBucket: 'inventory-8b0ad.firebasestorage.app',
  messagingSenderId: '165252469952',
  appId: '1:165252469952:web:1dec34907cc003fd2c4925',
  measurementId: 'G-YK1FRTQT8P',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  // Customize notification here
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/icons/icon-72x72.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
