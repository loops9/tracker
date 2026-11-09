// Estrazione prezzi dalla pagina prodotto Cardmarket.
//
// Sta in un file a sé per tre motivi: background.js la carica con
// importScripts e la inietta nelle tab con executeScript; il content script
// della vetrina la riusa per leggere l'immagine; i test la eseguono su
// pagine di esempio. Deve restare autosufficiente (niente riferimenti a
// funzioni esterne) perché executeScript ne serializza solo il corpo.

// Eseguita DENTRO la pagina Cardmarket (stessa identica logica validata
// nello script Python: stessi selettori sull'HTML reale della tabella).
// filtroInfo (opzionale): se impostato, conta solo le inserzioni il cui
// campo "informazioni" del venditore contiene questo testo (es. "PSA 10").
// L'immagine viene scaricata QUI, dal contesto della pagina: così la
// richiesta parte con il Referer di Cardmarket e la protezione hotlink
// del loro CDN non la rifiuta (dal service worker risponde 403).
async function estraiPrezzoMinimoItalia(filtroInfo) {
  const righe = document.querySelectorAll(".article-row");

  if (righe.length === 0) {
    const titolo = (document.title || "").toLowerCase();
    const sembraSfidaCloudflare =
      /just a moment|attendere|checking your browser|un momento/.test(titolo) ||
      document.querySelector("#challenge-running, #cf-challenge-running, [class*='cf-challenge']");
    // Blocco vero e proprio (403 "Attention Required! | Cloudflare"): non è
    // una sfida che si risolve da sola, e senza questo controllo verrebbe
    // scambiato per "nessuna inserzione".
    const bloccoCloudflare =
      /attention required|cloudflare|access denied|accesso negato/.test(titolo) ||
      document.querySelector("#cf-wrapper, #cf-error-details, .cf-error-code");
    if (sembraSfidaCloudflare || bloccoCloudflare) {
      return { prezzo: null, media3: null, nOfferte: 0, immagineUrl: null, immagineErrore: "pagina bloccata", bloccato: true };
    }
    // Zero righe valgono "nessuna inserzione" solo se la pagina è davvero una
    // scheda prodotto; altrimenti (errore, manutenzione, login) non so nulla.
    const paginaProdotto = document.querySelector(".info-list-container, dl.labeled, .page-title-container h1");
    if (!paginaProdotto) {
      return { prezzo: null, media3: null, nOfferte: 0, immagineUrl: null, immagineErrore: "pagina non riconosciuta", bloccato: true };
    }
  }

  const normalizza = (s) => (s || "").toLowerCase().replace(/[\s\-_]/g, "");
  const termini = filtroInfo
    ? String(filtroInfo).split(/[|,]/).map(normalizza).filter(Boolean)
    : [];

  const prezzi = [];
  righe.forEach((riga) => {
    // Il paese del venditore sta in "Locazione dell'oggetto: <paese>". Cardmarket
    // lo mette a volte in aria-label, a volte (pagine promo, tooltip Bootstrap)
    // nell'attributo title: controllo entrambi.
    const elPaese = riga.querySelector(
      "[aria-label^='Locazione'], [title^='Locazione'], [data-original-title^='Locazione']"
    );
    const elPrezzo = riga.querySelector(".col-offer .price-container span.color-primary");
    if (!elPaese || !elPrezzo) return;

    const etichettaPaese =
      elPaese.getAttribute("aria-label") ||
      elPaese.getAttribute("title") ||
      elPaese.getAttribute("data-original-title") ||
      "";
    const paese = etichettaPaese.split(":").pop().trim();
    if (paese.toLowerCase() !== "italia") return;

    if (termini.length) {
      const elCommento = riga.querySelector(".product-comments");
      const commentoNorm = normalizza(elCommento ? elCommento.textContent : "");
      if (!termini.some((t) => commentoNorm.includes(t))) return;
    }

    // Prezzo in formato europeo: "6.199,00 €". Il punto è separatore delle
    // migliaia (vanno rimossi TUTTI), la virgola è il separatore decimale.
    const soloNumero = elPrezzo.textContent.replace(/[^\d.,]/g, "");
    const testo = soloNumero.replace(/\./g, "").replace(",", ".");
    const valore = parseFloat(testo);
    if (!Number.isNaN(valore)) prezzi.push(valore);
  });

  // Immagine della carta: la pagina può avere un carosello con più carte,
  // quindi scelgo l'immagine il cui alt contiene il codice della carta
  // (es. "OP16-098") estratto dall'URL della pagina stessa.
  const segmento = decodeURIComponent((location.pathname.split("/").filter(Boolean).pop() || ""));
  const matchCodice = segmento.match(/([A-Z]{1,5}\d*-\d+)/);
  const codice = matchCodice ? matchCodice[1].toLowerCase() : null;

  let urlImg = null;
  const candidate = Array.from(document.querySelectorAll(".card-image img"));

  if (codice && candidate.length) {
    const conCodice = candidate.filter((img) => (img.alt || "").toLowerCase().includes(codice));
    const scelta = conCodice.find((img) => img.classList.contains("is-front")) || conCodice[0];
    if (scelta) urlImg = scelta.currentSrc || scelta.src || null;
  }
  if (!urlImg) {
    const og = document.querySelector("meta[property='og:image']");
    urlImg = (og && og.getAttribute("content")) || null;
  }
  if (!urlImg && candidate.length) {
    urlImg = candidate[0].currentSrc || candidate[0].src || null;
  }

  prezzi.sort((a, b) => a - b);
  const primi3 = prezzi.slice(0, 3);
  const media3 = primi3.length
    ? Math.round((primi3.reduce((s, v) => s + v, 0) / primi3.length) * 100) / 100
    : null;

  return {
    prezzo: prezzi.length ? prezzi[0] : null,
    media3,
    nOfferte: prezzi.length,
    prezzi, // tutti i prezzi italiani, crescenti: la vetrina ci calcola il prezzo di mercato
    immagineUrl: urlImg,
    immagineErrore: urlImg ? null : "immagine non trovata nella pagina",
    bloccato: false,
  };
}

if (typeof module !== "undefined") module.exports = { estraiPrezzoMinimoItalia };
