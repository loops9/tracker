// Logica della vetrina senza effetti collaterali: niente chrome.*, niente
// rete, niente DOM. La usano il service worker (importScripts), la pagina
// options (<script>) e i test Node (require).

var VETRINA_CONDIZIONI = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
var VETRINA_LINGUE = [
  "Inglese", "Giapponese", "Francese", "Italiano", "Tedesco", "Spagnolo",
  "Cinese semplificato", "Cinese tradizionale", "Coreano",
];
var VETRINA_SOGLIA_SCOSTAMENTO = 20; // % oltre cui lo scostamento viene evidenziato
var VETRINA_IMG_LARGHEZZA = 480;
var VETRINA_CARTELLA = "vetrina";

// "6.199,00 €" -> 6199. Stessa regola di estraiPrezzoMinimoItalia: il punto
// separa le migliaia, la virgola i decimali.
function parsePrezzoEuro(testo) {
  var soloNumero = String(testo == null ? "" : testo).replace(/[^\d.,]/g, "");
  var valore = parseFloat(soloNumero.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(valore) ? null : valore;
}

// Prezzo di mercato = media dei 3 prezzi più bassi, arrotondata al centesimo.
// I conti sono in centesimi interi, così 1.005 e simili non sbagliano per
// colpa della virgola mobile. Con meno di 3 prezzi media su quelli che ci
// sono; con zero prezzi marketPrice resta null.
function calcolaMarketPrice(prezzi) {
  var validi = (prezzi || [])
    .filter(function (p) { return typeof p === "number" && Number.isFinite(p) && p >= 0; })
    .sort(function (a, b) { return a - b; })
    .slice(0, 3);
  if (!validi.length) return { marketPrice: null, marketSampleSize: 0 };
  var centesimi = validi.reduce(function (s, p) { return s + Math.round(p * 100); }, 0);
  return {
    marketPrice: Math.round(centesimi / validi.length) / 100,
    marketSampleSize: validi.length,
  };
}

// Prezzo esposto in vetrina: l'override manuale vince sempre.
function prezzoMostrato(carta) {
  if (carta && typeof carta.customPrice === "number" && Number.isFinite(carta.customPrice)) {
    return carta.customPrice;
  }
  if (carta && typeof carta.marketPrice === "number" && Number.isFinite(carta.marketPrice)) {
    return carta.marketPrice;
  }
  return null;
}

// Scostamento % del prezzo personale da quello di mercato (null se manca uno dei due).
function scostamentoPct(carta) {
  if (!carta || typeof carta.customPrice !== "number" || typeof carta.marketPrice !== "number") return null;
  if (carta.marketPrice <= 0) return null;
  return ((carta.customPrice - carta.marketPrice) / carta.marketPrice) * 100;
}

function scostamentoAlto(carta) {
  var s = scostamentoPct(carta);
  return s != null && Math.abs(s) > VETRINA_SOGLIA_SCOSTAMENTO;
}

// "12,5" / "12.50" / "" -> 12.5 / 12.5 / null. Per i campi del prezzo personale.
function leggiPrezzoInput(testo) {
  var t = String(testo == null ? "" : testo).trim().replace(/\s|€/g, "");
  if (!t) return null;
  if (!/^[\d.,]+$/.test(t)) return NaN;
  // con un solo separatore seguito da 1-2 cifre lo considero decimale, in
  // entrambe le forme; altrimenti formato europeo ("1.234,50")
  var valore = /^\d+([.,]\d{1,2})?$/.test(t) ? parseFloat(t.replace(",", ".")) : parsePrezzoEuro(t);
  if (valore == null || !(valore > 0)) return NaN;
  return Math.round(valore * 100) / 100;
}

// URL prodotto canonico: senza query/hash e con l'interfaccia in italiano,
// perché l'estrazione riconosce il paese dall'etichetta "Locazione".
function normalizzaUrlProdotto(url) {
  var u = new URL(url);
  u.search = "";
  u.hash = "";
  u.pathname = u.pathname.replace(/^\/[a-z]{2}\//, "/it/");
  return u.toString();
}

function nuovoIdVetrina(ora, casuale) {
  var t = (ora == null ? Date.now() : ora).toString(36);
  var r = (casuale == null ? Math.random() : casuale).toString(36).slice(2, 7);
  return "c" + t + r;
}

function nuovaCartaVetrina(dati, ora) {
  ora = ora == null ? Date.now() : ora;
  var quantita = parseInt(dati.quantita, 10);
  return {
    id: dati.id || nuovoIdVetrina(ora),
    url: normalizzaUrlProdotto(dati.url),
    nome: String(dati.nome || "").trim(),
    codice: String(dati.codice || "").trim(),
    espansione: String(dati.espansione || "").trim(),
    rarita: String(dati.rarita || "").trim(),
    condizione: dati.condizione || "NM",
    lingua: dati.lingua || "Inglese",
    quantita: quantita > 0 ? quantita : 1,
    immagineUrl: dati.immagineUrl || null,
    filtroInfo: dati.filtroInfo || null, // es. "PSA 10": vale anche per il prezzo di mercato
    marketPrice: null,
    marketSampleSize: 0,
    marketStato: "da aggiornare",
    marketAggiornatoIl: null,
    customPrice: null,
    sold: false,
    updatedAt: ora,
  };
}

// Applica il risultato dello scraping. Non tocca MAI customPrice.
// ris = { prezzi, bloccato } come restituito da estraiPrezzoMinimoItalia,
// oppure { errore } se l'apertura della pagina è fallita.
function applicaMercato(carta, ris, ora) {
  ora = ora == null ? Date.now() : ora;
  var out = Object.assign({}, carta);
  if (ris && ris.errore) {
    out.marketStato = "errore: " + ris.errore; // il prezzo precedente resta valido
  } else if (ris && ris.bloccato) {
    out.marketStato = "bloccato (anti-bot)";
  } else {
    var m = calcolaMarketPrice(ris && ris.prezzi);
    out.marketPrice = m.marketPrice;
    out.marketSampleSize = m.marketSampleSize;
    out.marketStato = m.marketSampleSize === 0 ? "nessuna inserzione italiana" : "ok";
    out.marketAggiornatoIl = ora;
    // Sempre l'immagine appena letta: corregge quelle sbagliate (es. versioni
    // alternative), e la ripubblicazione la ricarica perché cambia la sorgente.
    if (ris && immagineCartaValida(ris.immagineUrl)) out.immagineUrl = ris.immagineUrl;
  }
  out.updatedAt = ora;
  return out;
}

// Il tracker, quando non trova l'immagine di un prodotto (es. box sigillati),
// salva il logo di Cardmarket: per la vetrina equivale a nessuna immagine.
function immagineCartaValida(url) {
  if (!url || /static\.cardmarket\.com\/img\/logos\//i.test(url)) return null;
  return url;
}

// Dati della vetrina ricavati da una carta del tracker (lista "carte"):
// codice ed espansione dall'URL Cardmarket, prezzo di mercato dall'ultima
// rilevazione (media3 è già la media dei 3 prezzi italiani più bassi).
function datiDaCartaTracciata(carta) {
  var parti = new URL(carta.link).pathname.split("/").filter(Boolean);
  var ultimo = decodeURIComponent(parti[parti.length - 1] || "");
  var codice = (ultimo.match(/([A-Z]{1,5}\d*-\d+)/) || [])[1] || "";
  var iSingles = parti.indexOf("Singles");
  var espansione = iSingles !== -1 && parti[iSingles + 1]
    ? decodeURIComponent(parti[iSingles + 1]).replace(/-/g, " ")
    : "";
  return {
    url: carta.link,
    nome: carta.nome || "",
    codice: codice,
    espansione: espansione,
    rarita: "",
    lingua: /japanese/i.test(carta.link) ? "Giapponese" : "Inglese",
    immagineUrl: immagineCartaValida(carta.immagineUrl),
    filtroInfo: carta.filtroInfo || null,
  };
}

function mercatoDaCartaTracciata(carta) {
  if (carta.ultimaMedia3 == null || carta.ultimoBloccato || carta.ultimoErrore) return null;
  return {
    marketPrice: carta.ultimaMedia3,
    marketSampleSize: Math.min(3, carta.ultimeOfferte || 0),
    marketStato: "ok",
    marketAggiornatoIl: carta.ultimaData || null,
  };
}

function percorsoImmagineVetrina(carta) {
  return VETRINA_CARTELLA + "/img/" + carta.id + ".jpg";
}

// Il contenuto di vetrina/vetrina.json. Le carte senza alcun prezzo non
// vengono pubblicate (non si può costruire il link di pagamento).
// immagini: { [id]: true } per le carte la cui immagine è nel repo.
function costruisciVetrinaJson(carte, immagini, ora) {
  immagini = immagini || {};
  var pubblicate = [];
  var senzaPrezzo = [];
  (carte || []).forEach(function (c) {
    var prezzo = prezzoMostrato(c);
    if (prezzo == null) {
      senzaPrezzo.push(c);
      return;
    }
    pubblicate.push({
      id: c.id,
      nome: c.nome,
      codice: c.codice || "",
      espansione: c.espansione || "",
      rarita: c.rarita || "",
      condizione: c.condizione || "",
      lingua: c.lingua || "",
      quantita: c.quantita || 1,
      prezzo: prezzo,
      immagine: immagini[c.id] ? "img/" + c.id + ".jpg" : null,
      venduta: !!c.sold,
    });
  });
  return {
    dati: {
      versione: 1,
      aggiornatoIl: new Date(ora == null ? Date.now() : ora).toISOString(),
      carte: pubblicate,
    },
    senzaPrezzo: senzaPrezzo,
  };
}

// Stessa codifica UTF-8 -> base64 usata da sincronizzaGitHub.
function base64Utf8(testo) {
  return btoa(unescape(encodeURIComponent(testo)));
}

if (typeof module !== "undefined") {
  module.exports = {
    VETRINA_CONDIZIONI: VETRINA_CONDIZIONI,
    VETRINA_LINGUE: VETRINA_LINGUE,
    VETRINA_SOGLIA_SCOSTAMENTO: VETRINA_SOGLIA_SCOSTAMENTO,
    parsePrezzoEuro: parsePrezzoEuro,
    calcolaMarketPrice: calcolaMarketPrice,
    prezzoMostrato: prezzoMostrato,
    scostamentoPct: scostamentoPct,
    scostamentoAlto: scostamentoAlto,
    leggiPrezzoInput: leggiPrezzoInput,
    normalizzaUrlProdotto: normalizzaUrlProdotto,
    nuovoIdVetrina: nuovoIdVetrina,
    nuovaCartaVetrina: nuovaCartaVetrina,
    applicaMercato: applicaMercato,
    immagineCartaValida: immagineCartaValida,
    datiDaCartaTracciata: datiDaCartaTracciata,
    mercatoDaCartaTracciata: mercatoDaCartaTracciata,
    percorsoImmagineVetrina: percorsoImmagineVetrina,
    costruisciVetrinaJson: costruisciVetrinaJson,
    base64Utf8: base64Utf8,
  };
}
