import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  console.error('Bootstrap Error:', err);
  // Show error on screen for older browsers
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText =
    'padding:20px;color:red;font-family:sans-serif;text-align:center;';
  errorDiv.innerHTML = `
      <h2>⚠️ App Loading Error</h2>
      <p>Your browser may be outdated. Please try:</p>
      <ul style="text-align:left;display:inline-block;">
        <li>Update your browser to the latest version</li>
        <li>Try using Chrome or Firefox</li>
        <li>Clear browser cache and refresh</li>
      </ul>
      <p style="font-size:12px;color:#666;">Error: ${err?.message || err}</p>
    `;
  document.body.appendChild(errorDiv);
});
