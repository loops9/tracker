// Unione dei dati di due PC. Logica pura (niente chrome.*, niente rete):
// la usano il service worker (importScripts), le pagine e i test Node.
//
// Lo stato condiviso sta in data.json sul repo, insieme a quello che il
// Ledger già legge: { carte, storico, vetrina, eliminati, aggiornatoIl }.
// Ogni PC, prima di scrivere, scarica data.json, lo unisce ai propri dati
// con unisciStati e scrive il risultato sia in locale sia su GitHub.
//
// Regole:
// - carte tracciate (chiave: link): i campi decisi dall'utente (nome,
//   quantità, filtro) vengono dalla copia con modificatoIl più recente; i
//   dati dell'ultimo controllo prezzi dalla copia con ultimaData più recente.
// - vetrina (chiave: id): vince la copia con updatedAt più recente.
// - storico: unione delle righe, senza doppioni (link + data).
// - eliminazioni: eliminati.carte[link] / eliminati.vetrina[id] = quando.
//   Un elemento sparisce se è stato eliminato dopo la sua ultima modifica;
//   se viene riaggiunto più tardi, torna. Le eliminazioni più vecchie di
//   ELIMINATI_GIORNI vengono dimenticate.

var SYNC_VERSIONE = 1;
var ELIMINATI_GIORNI = 120;

var CAMPI_UTENTE_CARTA = ["nome", "quantita", "filtroInfo"];
var CAMPI_PREZZO_CARTA = [
  "ultimoPrezzo", "ultimaMedia3", "ultimeOfferte", "ultimaData", "ultimoErrore", "ultimoBloccato",
  "immagine", "immagineUrl", "immagineStato",
];

function numero(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Ultima modifica decisa dall'utente. Le carte create prima della
// sincronizzazione non hanno modificatoIl: valgono 0.
function modificaCarta(c) {
  return numero(c && c.modificatoIl);
}

function unisciCarta(a, b) {
  var utente = modificaCarta(b) > modificaCarta(a) ? b : a;
  var prezzo = numero(b.ultimaData) > numero(a.ultimaData) ? b : a;
  var out = Object.assign({}, a, b, utente);
  CAMPI_UTENTE_CARTA.forEach(function (k) {
    if (k in utente) out[k] = utente[k];
  });
  CAMPI_PREZZO_CARTA.forEach(function (k) {
    if (k in prezzo) out[k] = prezzo[k];
  });
  // l'ultima immagine buona non si perde se il controllo più recente non l'ha trovata
  if (!out.immagine && (a.immagine || b.immagine)) out.immagine = a.immagine || b.immagine;
  if (!out.immagineUrl && (a.immagineUrl || b.immagineUrl)) out.immagineUrl = a.immagineUrl || b.immagineUrl;
  var m = Math.max(modificaCarta(a), modificaCarta(b));
  if (m) out.modificatoIl = m;
  return out;
}

function unisciEliminati(a, b, ora) {
  var limite = ora - ELIMINATI_GIORNI * 86400000;
  var out = {};
  [a || {}, b || {}].forEach(function (e) {
    Object.keys(e).forEach(function (k) {
      var t = numero(e[k]);
      if (t > limite && t > numero(out[k])) out[k] = t;
    });
  });
  return out;
}

// Unisce due liste mantenendo l'ordine di "locale" e aggiungendo in fondo
// gli elementi che ci sono solo in "remoto" (nell'ordine di remoto).
function unisciLista(locale, remoto, chiave, unisci, eliminati, ultimaModifica) {
  var perChiave = new Map();
  var ordine = [];
  [locale || [], remoto || []].forEach(function (lista) {
    lista.forEach(function (el) {
      if (!el) return;
      var k = chiave(el);
      if (!k) return;
      if (perChiave.has(k)) {
        perChiave.set(k, unisci(perChiave.get(k), el));
      } else {
        perChiave.set(k, el);
        ordine.push(k);
      }
    });
  });
  return ordine
    .filter(function (k) {
      return !(numero(eliminati[k]) > 0 && numero(eliminati[k]) >= ultimaModifica(perChiave.get(k)));
    })
    .map(function (k) { return perChiave.get(k); });
}

function unisciStorico(a, b) {
  var visti = new Set();
  var out = [];
  (a || []).concat(b || []).forEach(function (r) {
    if (!r) return;
    var k = r.link + "\n" + r.data;
    if (visti.has(k)) return;
    visti.add(k);
    out.push(r);
  });
  out.sort(function (x, y) { return numero(x.data) - numero(y.data); });
  return out;
}

// locale/remoto = { carte, storico, vetrina, eliminati }. remoto può essere
// null (data.json non esiste ancora) o un vecchio data.json senza vetrina.
function unisciStati(locale, remoto, ora) {
  ora = ora == null ? Date.now() : ora;
  locale = locale || {};
  remoto = remoto || {};
  var elL = locale.eliminati || {};
  var elR = remoto.eliminati || {};
  var eliminati = {
    carte: unisciEliminati(elL.carte, elR.carte, ora),
    vetrina: unisciEliminati(elL.vetrina, elR.vetrina, ora),
  };
  var carte = unisciLista(
    locale.carte, remoto.carte,
    function (c) { return c.link; },
    unisciCarta,
    eliminati.carte,
    modificaCarta
  );
  var vetrina = unisciLista(
    locale.vetrina, remoto.vetrina,
    function (c) { return c.id; },
    function (a, b) { return numero(b.updatedAt) > numero(a.updatedAt) ? b : a; },
    eliminati.vetrina,
    function (c) { return numero(c.updatedAt); }
  );
  return {
    carte: carte,
    storico: unisciStorico(locale.storico, remoto.storico),
    vetrina: vetrina,
    eliminati: eliminati,
  };
}

// Stringa stabile per capire se due stati sono uguali (e quindi se serve
// scrivere in locale o fare un commit).
function impronta(stato) {
  return JSON.stringify({
    carte: stato.carte || [],
    storico: stato.storico || [],
    vetrina: stato.vetrina || [],
    eliminati: stato.eliminati || { carte: {}, vetrina: {} },
  });
}

// Il contenuto di data.json: lo legge anche il Ledger (carte, storico) e
// cmtrack sulla VPS (carte).
function contenutoDataJson(stato, ora) {
  return {
    formatoSync: SYNC_VERSIONE,
    carte: stato.carte,
    storico: stato.storico,
    vetrina: stato.vetrina,
    eliminati: stato.eliminati,
    aggiornatoIl: ora == null ? Date.now() : ora,
  };
}

// Registra un'eliminazione nello stato locale (da chiamare insieme alla
// rimozione dalla lista).
function conEliminazione(eliminati, tipo, chiave, ora) {
  var out = { carte: Object.assign({}, eliminati && eliminati.carte), vetrina: Object.assign({}, eliminati && eliminati.vetrina) };
  out[tipo][chiave] = ora == null ? Date.now() : ora;
  return out;
}

if (typeof module !== "undefined") {
  module.exports = {
    SYNC_VERSIONE: SYNC_VERSIONE,
    unisciStati: unisciStati,
    unisciCarta: unisciCarta,
    impronta: impronta,
    contenutoDataJson: contenutoDataJson,
    conEliminazione: conEliminazione,
  };
}
