const ALARM_NAME = "controlloGiornaliero";
const RITARDO_MIN_MS = 4000;
const RITARDO_MAX_MS = 9000;

function conFiltroItalia(url) {
  const u = new URL(url);
  u.searchParams.set("sellerCountry", "17"); // 17 = Italia (confermato da help.cardmarket.com/API_2.0:Articles)
  return u.toString();
}

chrome.runtime.onInstalled.addListener(() => {
  // Controllo solo manuale: niente allarme giornaliero. Se una versione
  // precedente aveva creato l'allarme, lo rimuovo per non farlo scattare.
  chrome.alarms.clear(ALARM_NAME);
  configuraRegolaReferer();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.tipo === "controllaOra") {
    controllaTutte().then(() => sendResponse({ ok: true }));
    return true; // indica risposta asincrona
  }
  if (msg?.tipo === "controllaUna") {
    controllaUna(msg.link)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, errore: String(e?.message || e) }));
    return true;
  }
  if (msg?.tipo === "sincronizzaOra") {
    sincronizzaGitHub()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, errore: String(e?.message || e) }));
    return true;
  }
});

// Elabora UNA carta: recupera prezzo/media/offerte e aggiorna la miniatura.
// Restituisce l'oggetto risultato (senza salvarlo), riusato sia dal controllo
// completo sia da quello di una singola carta.
async function elaboraCarta(carta) {
  try {
    const ris = await controllaCarta(carta.link, carta.filtroInfo);

    // Miniatura: riuso quella esistente se l'URL sorgente non è cambiato,
    // altrimenti la scarico dal service worker (con Referer riscritto).
    let miniatura = carta.immagine || null;
    let immagineStato;
    const haGiaMiniatura =
      String(miniatura || "").startsWith("data:") && ris.immagineUrl && carta.immagineUrl === ris.immagineUrl;

    if (haGiaMiniatura) {
      immagineStato = "ok (riusata)";
    } else if (!ris.immagineUrl) {
      immagineStato = ris.immagineErrore || "immagine non trovata";
    } else {
      const esito = await scaricaMiniatura(ris.immagineUrl);
      if (esito.dataUrl) {
        miniatura = esito.dataUrl;
        immagineStato = "ok";
      } else {
        immagineStato = esito.motivo;
      }
    }

    return {
      ...carta,
      prezzo: ris.prezzo,
      media3: ris.media3,
      nOfferte: ris.nOfferte,
      immagine: miniatura,
      immagineUrl: ris.immagineUrl || carta.immagineUrl || null,
      immagineStato,
      bloccato: ris.bloccato,
      data: Date.now(),
      errore: null,
    };
  } catch (e) {
    console.error("Cardmarket Tracker - errore su", carta.nome, e);
    return {
      ...carta,
      prezzo: null,
      media3: null,
      nOfferte: 0,
      immagine: carta.immagine || null,
      immagineUrl: carta.immagineUrl || null,
      immagineStato: carta.immagineStato || null,
      bloccato: false,
      data: Date.now(),
      errore: String(e?.message || e),
    };
  }
}

async function controllaTutte() {
  await configuraRegolaReferer();
  const { carte = [] } = await chrome.storage.local.get("carte");
  const risultati = [];

  for (const carta of carte) {
    risultati.push(await elaboraCarta(carta));
    await attesa(RITARDO_MIN_MS + Math.random() * (RITARDO_MAX_MS - RITARDO_MIN_MS));
  }

  await salvaRisultati(risultati);
  await chrome.storage.local.set({ ultimoControllo: Date.now() });
  await sincronizzaGitHub();
  return risultati;
}

// Controlla il prezzo di UNA sola carta (identificata dal link), senza toccare
// le altre. Salva il risultato e sincronizza su GitHub.
async function controllaUna(link) {
  await configuraRegolaReferer();
  const { carte = [] } = await chrome.storage.local.get("carte");
  const carta = carte.find((c) => c.link === link);
  if (!carta) return { ok: false, errore: "carta non trovata" };

  const risultato = await elaboraCarta(carta);
  await salvaRisultati([risultato]);
  await sincronizzaGitHub();
  return { ok: true, bloccato: risultato.bloccato, prezzo: risultato.prezzo, errore: risultato.errore };
}

function attesa(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Il CDN di Cardmarket rifiuta (403) le richieste immagine senza un Referer
// di cardmarket.com. Il service worker non può impostare quel header nella
// fetch, ma può farlo tramite una regola declarativeNetRequest che riscrive
// il Referer su tutte le richieste verso i domini cardmarket.com.
async function configuraRegolaReferer() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1001],
      addRules: [
        {
          id: 1001,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Referer", operation: "set", value: "https://www.cardmarket.com/" },
            ],
          },
          condition: {
            requestDomains: ["cardmarket.com"],
            resourceTypes: ["xmlhttprequest", "image", "other"],
          },
        },
      ],
    });
  } catch (e) {
    console.error("Cardmarket Tracker - regola Referer non installata", e);
  }
}

// Scarica l'immagine della carta e la trasforma in una miniatura JPEG
// incorporata come data URL: la pagina su GitHub Pages non deve più
// chiedere nulla ai server di Cardmarket. Restituisce { dataUrl, motivo }.
async function scaricaMiniatura(url) {
  if (!url) return { dataUrl: null, motivo: "nessun url immagine" };
  try {
    const risp = await fetch(url, { credentials: "include", cache: "no-cache" });
    if (!risp.ok) return { dataUrl: null, motivo: "http " + risp.status };
    const blob = await risp.blob();
    const bitmap = await createImageBitmap(blob);

    const larghezza = 160;
    const scala = larghezza / bitmap.width;
    const canvas = new OffscreenCanvas(larghezza, Math.max(1, Math.round(bitmap.height * scala)));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    const buf = new Uint8Array(await jpeg.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    }
    return { dataUrl: "data:image/jpeg;base64," + btoa(bin), motivo: "ok" };
  } catch (e) {
    console.error("Cardmarket Tracker - miniatura non scaricata", url, e);
    return { dataUrl: null, motivo: String((e && e.message) || e) };
  }
}

function controllaCarta(url, filtroInfo) {
  const urlFiltrato = conFiltroItalia(url);
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: urlFiltrato, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        reject(new Error(chrome.runtime.lastError?.message || "apertura tab fallita"));
        return;
      }
      const tabId = tab.id;

      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.remove(tabId).catch(() => {});
        reject(new Error("timeout caricamento pagina (oltre 45s)"));
      }, 45000);

      function listener(id, info) {
        if (id !== tabId || info.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeoutId);

        // margine dopo "complete" per dare tempo a un'eventuale sfida
        // automatica di Cloudflare di risolversi da sola
        setTimeout(() => {
          chrome.scripting.executeScript(
            { target: { tabId }, func: estraiPrezzoMinimoItalia, args: [filtroInfo || null] },
            (iniezione) => {
              chrome.tabs.remove(tabId).catch(() => {});
              if (chrome.runtime.lastError || !iniezione || !iniezione[0]) {
                reject(new Error(chrome.runtime.lastError?.message || "estrazione fallita"));
              } else {
                resolve(iniezione[0].result); // { prezzo, bloccato }
              }
            }
          );
        }, 5000);
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

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
    if (sembraSfidaCloudflare) {
      return { prezzo: null, media3: null, nOfferte: 0, immagineUrl: null, immagineErrore: "pagina bloccata", bloccato: true };
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
    immagineUrl: urlImg,
    immagineErrore: urlImg ? null : "immagine non trovata nella pagina",
    bloccato: false,
  };
}

async function sincronizzaGitHub() {
  const { githubOwner, githubRepo, githubToken, githubPath } = await chrome.storage.local.get([
    "githubOwner",
    "githubRepo",
    "githubToken",
    "githubPath",
  ]);
  if (!githubOwner || !githubRepo || !githubToken) return; // sync non configurata, salta senza errori

  const path = githubPath || "data.json";
  const { carte = [], storico = [] } = await chrome.storage.local.get(["carte", "storico"]);
  const contenuto = JSON.stringify({ carte, storico, aggiornatoIl: Date.now() }, null, 2);
  const contenutoBase64 = btoa(unescape(encodeURIComponent(contenuto))); // supporto UTF-8 (accenti)

  const apiUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${path}`;
  const headersBase = {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let sha;
  try {
    const rispGet = await fetch(apiUrl, { headers: headersBase });
    if (rispGet.ok) {
      sha = (await rispGet.json()).sha;
    }
  } catch (e) {
    console.error("Cardmarket Tracker - errore lettura data.json da GitHub", e);
  }

  const corpo = {
    message: `Aggiornamento prezzi ${new Date().toISOString()}`,
    content: contenutoBase64,
    branch: "main",
  };
  if (sha) corpo.sha = sha;

  try {
    const rispPut = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...headersBase, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (!rispPut.ok) {
      console.error("Cardmarket Tracker - sync GitHub fallita", rispPut.status, await rispPut.text());
    }
  } catch (e) {
    console.error("Cardmarket Tracker - errore invio a GitHub", e);
  }
}

async function salvaRisultati(risultati) {
  const { carte = [], storico = [] } = await chrome.storage.local.get(["carte", "storico"]);

  const carteAggiornate = carte.map((c) => {
    const r = risultati.find((x) => x.link === c.link);
    if (!r) return c;
    return {
      ...c,
      ultimoPrezzo: r.prezzo,
      ultimaMedia3: r.media3,
      ultimeOfferte: r.nOfferte,
      immagine: r.immagine || c.immagine || null, // conserva l'ultima immagine buona
      immagineUrl: r.immagineUrl || c.immagineUrl || null,
      immagineStato: r.immagineStato || c.immagineStato || null,
      ultimaData: r.data,
      ultimoErrore: r.errore,
      ultimoBloccato: r.bloccato,
    };
  });

  const nuoveRigheStorico = risultati
    .filter((r) => r.prezzo != null)
    .map((r) => ({
      nome: r.nome,
      link: r.link,
      prezzo: r.prezzo,
      media3: r.media3,
      nOfferte: r.nOfferte,
      data: r.data,
    }));

  await chrome.storage.local.set({
    carte: carteAggiornate,
    storico: [...storico, ...nuoveRigheStorico],
  });
}
