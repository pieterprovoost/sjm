const FILES_TO_CACHE = [
    "/offline",
    "/public/bootstrap-4.4.1-dist/css/bootstrap.css",
    "/public/fonts.css",
    "/public/style.css",
    "/public/devleugels.png",
    "/public/smogjemee_fixed.png"
];

const CACHE_NAME = "smog-2";

self.addEventListener("install", function(event) {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(FILES_TO_CACHE);
        })
    );
});

self.addEventListener("fetch", function(event) {
    if (new URL(event.request.url).origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((r) => {
            console.log('[Service Worker] Fetching resource: ' + event.request.url);
            if (r) return r;
            return fetch(event.request)
                .then(res => {
                    return res;
                })
                .catch(e => {
                    return caches.match("/offline");
                });
        })
    );

});

self.addEventListener("activate", function(event) {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log("[ServiceWorker] Removing old cache", key);
                    return caches.delete(key);
                }
            }));
        }).then(function() {
            return self.clients.claim();
        })
    );
});

