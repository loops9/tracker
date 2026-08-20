// Service worker del Cardmarket Ledger.
//
// Serve a due cose:
//  - aprire la pagina in modo istantaneo (e anche senza rete) quando è
//    aggiunta alla schermata Home;
//  - non riscaricare data.json quando non è cambiato.
//
// Per forzare un aggiornamento di tutti i file salvati, cambia VERSIONE.

var VERSIONE = 'ledger-v1';
var STATICI = ['./', './index.html'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSIONE)
      .then(function (c) { return c.addAll(STATICI); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (chiavi) {
        return Promise.all(chiavi.map(function (k) {
          return k === VERSIONE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function salva(req, risposta) {
  if (risposta && risposta.ok) {
    var copia = risposta.clone();
    caches.open(VERSIONE).then(function (c) { c.put(req, copia); });
  }
  return risposta;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Prezzi: prima la rete (sono il dato che deve essere fresco), la copia
  // salvata resta come rete di sicurezza quando si è offline.
  if (url.pathname.indexOf('data.json') !== -1) {
    e.respondWith(
      fetch(req)
        .then(function (r) { return salva(req, r); })
        .catch(function () { return caches.match(req, { ignoreSearch: true }); })
    );
    return;
  }

  // Pagina e statici: prima la copia salvata (apertura immediata), poi
  // aggiornamento in background per il prossimo avvio.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (salvata) {
      var rete = fetch(req)
        .then(function (r) { return salva(req, r); })
        .catch(function () { return salvata; });
      return salvata || rete;
    })
  );
});
