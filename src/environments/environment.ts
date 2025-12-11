export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  socketUrl: 'http://localhost:3001',
  // Hugging Face Token for Gemma AI - Set via localStorage.setItem('hf_token', 'your_token')
  // Get token from: https://huggingface.co/settings/tokens
  huggingFaceToken: '',
  firebaseConfig: {
    apiKey: 'AIzaSyDJL01CQ2KJGqni6Q3EPR8Yv1CPW6cXezk',
    authDomain: 'inventory-8b0ad.firebaseapp.com',
    projectId: 'inventory-8b0ad',
    storageBucket: 'inventory-8b0ad.firebasestorage.app',
    messagingSenderId: '165252469952',
    appId: '1:165252469952:web:1dec34907cc003fd2c4925',
    measurementId: 'G-YK1FRTQT8P',
  },
};
