importScripts("estrai.js", "vetrina-core.js", "github.js");

const ALARM_NAME = "controlloGiornaliero";
// Scraping: più schede insieme, aperte in background (non prendono il focus
// e non cambiano la scheda che si sta guardando), lette appena l'HTML è arrivato. SFASAMENTO distanzia l'apertura delle schede per non
// presentarsi a Cloudflare con una raffica di richieste nello stesso istante.
const SCHEDE_PARALLELE = 4;
const SFASAMENTO_MIN_MS = 300;
const SFASAMENTO_MAX_MS = 1200;
const ATTESA_MAX_MS = 45000;

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

// Le regole di sessione spariscono alla chiusura del browser: le reinstallo
// all'avvio, così le immagini di Cardmarket si caricano anche nella pagina
// di gestione vetrina.
chrome.runtime.onStartup.addListener(() => {
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
  if (msg?.tipo === "aggiornaVetrina") {
    aggiornaVetrina(msg.id || null)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, errore: String(e?.message || e) }));
    return true;
  }
  if (msg?.tipo === "pubblicaVetrina") {
    pubblicaVetrina()
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, errore: String(e?.message || e) }));
    return true;
  }
  if (msg?.tipo === "preparaImmagini") {
    configuraRegolaReferer().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.tipo === "apriOpzioni") {
    chrome.runtime.openOptionsPage();
    return;
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
  const risultati = await inParallelo(carte, elaboraCarta);

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
async function scaricaMiniatura(url, larghezza = 160) {
  if (!url) return { dataUrl: null, motivo: "nessun url immagine" };
  try {
    const risp = await fetch(url, { credentials: "include", cache: "no-cache" });
    if (!risp.ok) return { dataUrl: null, motivo: "http " + risp.status };
    const blob = await risp.blob();
    const bitmap = await createImageBitmap(blob);

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

// Esegue lavoro(elemento) su tutti gli elementi, al massimo
// SCHEDE_PARALLELE alla volta. Restituisce i risultati nello stesso ordine.
//
// Nota: una finestra separata ridotta a icona sarebbe stata più discreta, ma
// Chrome la ripristina quando ci si apre una scheda (provato su Linux): le
// schede in background nella finestra corrente sono l'unica via affidabile.
async function inParallelo(elementi, lavoro, alProgresso) {
  if (!elementi.length) return [];
  const risultati = new Array(elementi.length);
  let prossimo = 0;
  let fatti = 0;
  const operaio = async () => {
    while (prossimo < elementi.length) {
      const i = prossimo++;
      await attesa(SFASAMENTO_MIN_MS + Math.random() * (SFASAMENTO_MAX_MS - SFASAMENTO_MIN_MS));
      risultati[i] = await lavoro(elementi[i]);
      fatti++;
      if (alProgresso) await alProgresso(fatti, elementi.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCHEDE_PARALLELE, elementi.length) }, operaio));
  return risultati;
}

// Apre la pagina (filtrata sui venditori italiani) in una scheda in
// background e la legge appena è pronta.
async function controllaCarta(url, filtroInfo) {
  const tab = await chrome.tabs.create({ url: conFiltroItalia(url), active: false });
  try {
    return await leggiQuandoPronta(tab.id, filtroInfo);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Interroga la scheda finché l'HTML è arrivato (readyState "interactive"),
// senza aspettare immagini e script esterni. Durante una sfida Cloudflare
// aspetta che si risolva; se allo scadere è ancora lì, l'estrazione la
// riconosce e restituisce bloccato: true.
async function leggiQuandoPronta(tabId, filtroInfo) {
  const scadenza = Date.now() + ATTESA_MAX_MS;
  let stato = "caricamento";
  while (Date.now() < scadenza) {
    await attesa(250);
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId },
        injectImmediately: true,
        func: statoPaginaCardmarket,
      });
      stato = r?.result || "caricamento";
    } catch (e) {
      // pagina ancora in navigazione: il documento non è iniettabile
      if (/No tab with id/i.test(String(e?.message))) throw new Error("scheda chiusa durante il controllo");
      continue;
    }
    if (stato === "pronta") break;
  }
  if (stato === "caricamento") throw new Error("timeout caricamento pagina (oltre 45s)");

  const [iniezione] = await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,
    func: estraiPrezzoMinimoItalia,
    args: [filtroInfo || null],
  });
  if (!iniezione) throw new Error("estrazione fallita");
  return iniezione.result;
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

// ------------------------------------------------------------------ vetrina
//
// La vetrina è una lista separata dalle carte tracciate (chiave "vetrina").
// Ogni scrittura rilegge la lista e modifica solo la carta interessata, così
// un aggiornamento prezzi lungo non cancella le modifiche fatte nel frattempo
// dalla pagina options.

async function modificaCartaVetrina(id, modifica) {
  const { vetrina = [] } = await chrome.storage.local.get("vetrina");
  const i = vetrina.findIndex((c) => c.id === id);
  if (i === -1) return null;
  vetrina[i] = modifica(vetrina[i]);
  await chrome.storage.local.set({ vetrina });
  return vetrina[i];
}

let vetrinaInAggiornamento = false;

// Aggiorna il prezzo di mercato di tutte le carte non vendute (o di una
// sola, con id). Le carte con la stessa pagina (URL + filtro) condividono
// una sola visita. Stesso scraping del tracker, più schede in parallelo.
async function aggiornaVetrina(soloId) {
  if (vetrinaInAggiornamento) throw new Error("aggiornamento prezzi già in corso");
  vetrinaInAggiornamento = true;
  try {
    await configuraRegolaReferer();
    const { vetrina = [] } = await chrome.storage.local.get("vetrina");
    const daFare = vetrina.filter((c) => (soloId ? c.id === soloId : !c.sold));
    const chiave = (c) => c.url + "\n" + (c.filtroInfo || "");
    const pagine = [...new Map(daFare.map((c) => [chiave(c), c])).values()];
    const esito = { aggiornate: 0, senzaInserzioni: 0, bloccate: 0, errori: 0 };
    await chrome.storage.local.set({ vetrinaProgresso: { fatte: 0, totale: pagine.length, inCorso: true } });

    await inParallelo(
      pagine,
      async (pagina) => {
        let ris;
        try {
          ris = await controllaCarta(pagina.url, pagina.filtroInfo);
        } catch (e) {
          ris = { errore: String(e?.message || e) };
        }
        if (ris.errore) esito.errori++;
        else if (ris.bloccato) esito.bloccate++;
        else if (!ris.prezzi?.length) esito.senzaInserzioni++;
        else esito.aggiornate++;

        const ora = Date.now();
        for (const c of daFare.filter((x) => chiave(x) === chiave(pagina))) {
          await modificaCartaVetrina(c.id, (attuale) => applicaMercato(attuale, ris, ora));
        }
      },
      (fatte, totale) => chrome.storage.local.set({ vetrinaProgresso: { fatte, totale, inCorso: fatte < totale } })
    );
    return esito;
  } finally {
    vetrinaInAggiornamento = false;
  }
}

function dataUrlInBase64(dataUrl) {
  return String(dataUrl).slice(String(dataUrl).indexOf(",") + 1);
}

// Pubblica vetrina/vetrina.json e le immagini in vetrina/img/. Le immagini
// vanno nel repo perché il CDN di Cardmarket rifiuta le richieste che non
// arrivano da cardmarket.com: da GitHub Pages non si caricherebbero.
async function pubblicaVetrina() {
  const cfg = await chrome.storage.local.get(["githubOwner", "githubRepo", "githubToken"]);
  await verificaAccessoGitHub(cfg);
  await configuraRegolaReferer();

  const avvisi = [];
  const { vetrina = [] } = await chrome.storage.local.get("vetrina");
  const immagini = {};

  for (const c of vetrina) {
    if (c.immagineFile && c.immagineFileSorgente === c.immagineUrl) {
      immagini[c.id] = true;
      continue;
    }
    if (!c.immagineUrl) {
      avvisi.push(`${c.nome}: nessuna immagine`);
      continue;
    }
    const esito = await scaricaMiniatura(c.immagineUrl, VETRINA_IMG_LARGHEZZA);
    if (!esito.dataUrl) {
      avvisi.push(`${c.nome}: immagine non scaricata (${esito.motivo})`);
      continue;
    }
    const path = percorsoImmagineVetrina(c);
    await scriviFileGitHub(cfg, path, dataUrlInBase64(esito.dataUrl), `Vetrina: immagine ${c.nome}`);
    await modificaCartaVetrina(c.id, (attuale) => ({
      ...attuale,
      immagineFile: path,
      immagineFileSorgente: c.immagineUrl,
    }));
    immagini[c.id] = true;
  }

  const { dati, senzaPrezzo } = costruisciVetrinaJson(vetrina, immagini, Date.now());
  senzaPrezzo.forEach((c) => avvisi.push(`${c.nome}: nessun prezzo, non pubblicata`));
  await scriviFileGitHub(
    cfg,
    `${VETRINA_CARTELLA}/vetrina.json`,
    base64Utf8(JSON.stringify(dati, null, 2)),
    `Vetrina aggiornata ${dati.aggiornatoIl}`
  );

  // Immagini di carte tolte dalla vetrina: le rimuovo dal repo. Un errore
  // qui non invalida la pubblicazione, che è già avvenuta.
  try {
    const presenti = await elencaCartellaGitHub(cfg, `${VETRINA_CARTELLA}/img`);
    const usate = new Set(vetrina.filter((c) => immagini[c.id]).map((c) => percorsoImmagineVetrina(c)));
    for (const f of presenti) {
      if (f.type === "file" && !usate.has(f.path)) {
        await eliminaFileGitHub(cfg, f.path, f.sha, `Vetrina: rimuovi ${f.name}`);
      }
    }
  } catch (e) {
    avvisi.push("pulizia immagini vecchie non riuscita: " + (e?.message || e));
  }

  await chrome.storage.local.set({ vetrinaPubblicataIl: Date.now() });
  return { pubblicate: dati.carte.length, avvisi, url: urlPagesVetrina(cfg) };
}
