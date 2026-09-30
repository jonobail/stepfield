import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent)
  .then(registerServiceWorker)
  .catch(console.error);

/** Cache the app shell for offline use in production builds. */
function registerServiceWorker() {
  if (isDevMode() || !('serviceWorker' in navigator)) return;
  const worker = new URL('service-worker.js', document.baseURI);
  navigator.serviceWorker.register(worker).catch(error => console.error('Stepfield offline support could not be started.', error));
}
