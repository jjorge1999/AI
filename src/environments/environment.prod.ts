export const environment = {
  production: true,
  apiUrl: 'https://inventory-three-theta.vercel.app/api',
  // Hugging Face Token - Set at runtime via: localStorage.setItem('hf_token', 'your_token')
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
  // apiUrl: 'https://inventory-f13oeaw4j-jomzs-projects-d0964e3c.vercel.app/api'
};
