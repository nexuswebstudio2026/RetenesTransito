/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

// Precache list injected by VitePWA
const precacheManifest = (self as any).__WB_MANIFEST || [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('app-precache').then((cache) => {
      const urls = precacheManifest.map((entry: any) => typeof entry === 'string' ? entry : entry.url);
      return cache.addAll(urls);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== 'app-precache') {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Runtime fetch cache for Map tiles & Leaflet CDN
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Cache Leaflet CDN assets and OpenStreetMap tiles
  if (
    url.hostname.includes('unpkg.com') || 
    url.hostname.includes('tile.openstreetmap.org') ||
    url.pathname.startsWith('/api/')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Fetch fresh in background
          fetch(event.request).then((freshResponse) => {
            if (freshResponse.status === 200) {
              caches.open('runtime-cache').then((cache) => cache.put(event.request, freshResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }

        return fetch(event.request).then((response) => {
          if (response.status === 200) {
            const cloned = response.clone();
            caches.open('runtime-cache').then((cache) => cache.put(event.request, cloned));
          }
          return response;
        });
      })
    );
    return;
  }

  // Precache matching
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// PUSH NOTIFICATION RECEIVER
self.addEventListener('push', (event: PushEvent) => {
  let payload = { title: 'RetenAlerta', body: 'Alerta de tránsito ciudadana', icon: '/pwa-192x192.png' };
  
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  const options: any = {
    body: payload.body,
    icon: payload.icon || '/pwa-192x192.png',
    badge: '/icon.svg',
    vibrate: [200, 100, 200],
    data: (payload as any).data || { url: '/' },
    actions: [
      { action: 'open', title: 'Ver Mapa' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// NOTIFICATION CLICK ACTION
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
