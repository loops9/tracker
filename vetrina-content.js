// Content script sulle pagine prodotto One Piece di Cardmarket: aggiunge il
// pulsante "Metti in vetrina". Nome, codice, espansione, rarità e immagine
// vengono letti dalla pagina; condizione, lingua e quantità le sceglie
// l'utente in un piccolo modulo (tutti i campi restano modificabili, nel
// caso Cardmarket cambi la struttura della pagina).

// Legge i dati della carta dal DOM. Le etichette della scheda informativa
// (dl.labeled) sono cercate in italiano e in inglese.
function leggiDatiProdottoCardmarket(doc, loc) {
  const pulisci = (s) => String(s || "").replace(/\s+/g, " ").trim();

  const campi = {};
  doc.querySelectorAll("dl dt").forEach((dt) => {
    const dd = dt.nextElementSibling;
    if (!dd || dd.tagName !== "DD") return;
    // la rarità è un'icona: il nome sta negli attributi, non nel testo
    const icona = dd.querySelector("[aria-label], [data-bs-original-title], [data-original-title], [title]");
    const daIcona = icona
      ? icona.getAttribute("aria-label") || icona.getAttribute("data-bs-original-title") ||
        icona.getAttribute("data-original-title") || icona.getAttribute("title")
      : "";
    campi[pulisci(dt.textContent).toLowerCase()] = pulisci(dd.textContent) || pulisci(daIcona);
  });
  const campo = (...nomi) => {
    for (const n of nomi) if (campi[n]) return campi[n];
    return "";
  };

  const segmento = decodeURIComponent(loc.pathname.split("/").filter(Boolean).pop() || "");
  const codiceUrl = (segmento.match(/([A-Z]{1,5}\d*-\d+)/) || [])[1] || "";
  const codice = campo("numero", "number") || codiceUrl;

  // h1: "Nome carta (OP01-024)" con l'espansione in uno <span> annidato
  const h1 = doc.querySelector(".page-title-container h1, h1");
  let nome = "";
  let espansioneTitolo = "";
  if (h1) {
    const copia = h1.cloneNode(true);
    const span = copia.querySelector("span");
    if (span) {
      espansioneTitolo = pulisci(span.textContent);
      span.remove();
    }
    nome = pulisci(copia.textContent);
    if (codice) nome = pulisci(nome.replace("(" + codice + ")", ""));
  }

  return {
    nome,
    codice,
    espansione: campo("stampato in", "printed in", "espansione", "expansion") || espansioneTitolo,
    rarita: campo("rarità", "rarita", "rarity"),
  };
}

function linguaProbabile(url, espansione) {
  return /japanese|giappon/i.test(url + " " + espansione) ? "Giapponese" : "Inglese";
}

// ---------------------------------------------------------------- interfaccia

const STILE_VETRINA = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .lancia {
    position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
    background: #141b31; color: #ece7da; border: 1px solid #c9a35f; border-radius: 4px;
    padding: 10px 16px; font-size: 14px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.35);
  }
  .lancia:hover { background: #1c2440; }
  .velo {
    position: fixed; inset: 0; z-index: 2147483001; background: rgba(5,8,18,.55);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  form {
    background: #141b31; color: #ece7da; border: 1px solid rgba(255,255,255,.1); border-radius: 6px;
    width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 18px;
    font-size: 14px; display: grid; gap: 10px;
  }
  h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #e5c584; }
  .testa { display: flex; gap: 12px; align-items: flex-start; }
  .testa img { width: 72px; border-radius: 3px; background: #1c2440; }
  label { display: grid; gap: 4px; font-size: 12px; color: #9aa3bb; }
  input, select {
    font-size: 14px; padding: 7px 8px; color: #ece7da; background: #0b1020;
    border: 1px solid rgba(255,255,255,.14); border-radius: 3px; width: 100%;
  }
  input:focus, select:focus { outline: 2px solid #c9a35f; outline-offset: 0; }
  .riga { display: grid; grid-template-columns: 1fr 1fr 80px; gap: 8px; }
  .due { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .azioni { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  button { font-size: 14px; padding: 8px 14px; border-radius: 3px; cursor: pointer; }
  .primario { background: #c9a35f; color: #0b1020; border: 1px solid #c9a35f; font-weight: 600; }
  .secondario { background: none; color: #ece7da; border: 1px solid rgba(255,255,255,.2); }
  .esito { font-size: 13px; color: #9aa3bb; min-height: 1em; }
  .esito a { color: #e5c584; }
`;

function creaElemento(tag, attributi, figli) {
  const el = document.createElement(tag);
  Object.entries(attributi || {}).forEach(([k, v]) => {
    if (k === "testo") el.textContent = v;
    else el.setAttribute(k, v);
  });
  (figli || []).forEach((f) => el.append(f));
  return el;
}

function campoTesto(etichetta, nome, valore, extra) {
  return creaElemento("label", { testo: etichetta }, [
    creaElemento("input", { name: nome, value: valore || "", ...(extra || {}) }),
  ]);
}

function campoScelta(etichetta, nome, opzioni, scelta) {
  const select = creaElemento("select", { name: nome });
  opzioni.forEach((o) => {
    const opt = creaElemento("option", { value: o, testo: o });
    if (o === scelta) opt.selected = true;
    select.append(opt);
  });
  return creaElemento("label", { testo: etichetta }, [select]);
}

async function apriModuloVetrina(radice) {
  const dati = leggiDatiProdottoCardmarket(document, location);
  // riuso l'estrazione del tracker per l'immagine (e per i prezzi, se la
  // pagina è già filtrata sui venditori italiani)
  let estratto = {};
  try {
    estratto = (await estraiPrezzoMinimoItalia(null)) || {};
  } catch (e) {
    estratto = {};
  }
  const immagineUrl = estratto.immagineUrl || "";

  const form = creaElemento("form", {}, [
    creaElemento("div", { class: "testa" }, [
      immagineUrl ? creaElemento("img", { src: immagineUrl, alt: "" }) : "",
      creaElemento("div", {}, [
        creaElemento("h2", { testo: "Metti in vetrina" }),
        creaElemento("div", { class: "esito", testo: "Controlla i dati letti dalla pagina." }),
      ]),
    ]),
    campoTesto("Nome", "nome", dati.nome, { required: "" }),
    creaElemento("div", { class: "due" }, [
      campoTesto("Codice", "codice", dati.codice),
      campoTesto("Rarità", "rarita", dati.rarita),
    ]),
    campoTesto("Espansione", "espansione", dati.espansione),
    creaElemento("div", { class: "riga" }, [
      campoScelta("Condizione", "condizione", VETRINA_CONDIZIONI, "NM"),
      campoScelta("Lingua", "lingua", VETRINA_LINGUE, linguaProbabile(location.href, dati.espansione)),
      campoTesto("Quantità", "quantita", "1", { type: "number", min: "1", step: "1", required: "" }),
    ]),
    campoTesto("URL immagine", "immagineUrl", immagineUrl),
    creaElemento("div", { class: "esito", "data-esito": "" }),
    creaElemento("div", { class: "azioni" }, [
      creaElemento("button", { type: "button", class: "secondario", "data-chiudi": "", testo: "Annulla" }),
      creaElemento("button", { type: "submit", class: "primario", testo: "Aggiungi" }),
    ]),
  ]);
  const velo = creaElemento("div", { class: "velo" }, [form]);
  radice.append(velo);
  form.querySelector("input[name=quantita]").focus();

  const chiudi = () => velo.remove();
  velo.addEventListener("click", (e) => { if (e.target === velo) chiudi(); });
  form.querySelector("[data-chiudi]").addEventListener("click", chiudi);
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") chiudi(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const filtrataItalia = new URL(location.href).searchParams.get("sellerCountry") === "17";
    const esito = await aggiungiAllaVetrina({
      url: location.href,
      nome: f.get("nome"),
      codice: f.get("codice"),
      rarita: f.get("rarita"),
      espansione: f.get("espansione"),
      condizione: f.get("condizione"),
      lingua: f.get("lingua"),
      quantita: f.get("quantita"),
      immagineUrl: f.get("immagineUrl") || null,
    }, filtrataItalia && !estratto.bloccato ? estratto : null);

    const box = form.querySelector("[data-esito]");
    box.textContent = esito + " ";
    const link = creaElemento("a", { href: "#", testo: "Apri la gestione vetrina" });
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      chrome.runtime.sendMessage({ tipo: "apriOpzioni" });
    });
    box.append(link);
    form.querySelector("button[type=submit]").disabled = true;
  });
}

// Se la stessa carta (URL, condizione, lingua) è già in vetrina aumento la
// quantità invece di creare un doppione.
async function aggiungiAllaVetrina(dati, estrattoItalia) {
  const { vetrina = [] } = await chrome.storage.local.get("vetrina");
  const nuova = nuovaCartaVetrina(dati);
  const esistente = vetrina.find(
    (c) => c.url === nuova.url && c.condizione === nuova.condizione && c.lingua === nuova.lingua && !c.sold
  );
  if (esistente) {
    esistente.quantita += nuova.quantita;
    esistente.updatedAt = Date.now();
    await chrome.storage.local.set({ vetrina });
    return `Era già in vetrina: quantità portata a ${esistente.quantita}.`;
  }
  const carta = estrattoItalia ? applicaMercato(nuova, estrattoItalia) : nuova;
  vetrina.push(carta);
  await chrome.storage.local.set({ vetrina });
  const prezzo = carta.marketPrice != null
    ? ` Prezzo di mercato ${carta.marketPrice.toFixed(2).replace(".", ",")} € (${carta.marketSampleSize} inserzioni).`
    : " Il prezzo verrà calcolato con \"Aggiorna prezzi\".";
  return `Aggiunta alla vetrina.${prezzo}`;
}

function montaPulsanteVetrina() {
  if (document.getElementById("cm-tracker-vetrina")) return;
  const host = document.createElement("div");
  host.id = "cm-tracker-vetrina";
  const radice = host.attachShadow({ mode: "open" });
  const stile = document.createElement("style");
  stile.textContent = STILE_VETRINA;
  const pulsante = creaElemento("button", { class: "lancia", type: "button", testo: "Metti in vetrina" });
  pulsante.addEventListener("click", () => apriModuloVetrina(radice));
  radice.append(stile, pulsante);
  document.documentElement.append(host);
}

// Solo sulle pagine di un singolo prodotto (hanno la tabella offerte o la
// scheda informativa), non sugli elenchi di espansione.
if (typeof chrome !== "undefined" && chrome.storage && document.querySelector(".article-row, dl.labeled, .info-list-container")) {
  montaPulsanteVetrina();
}

if (typeof module !== "undefined") module.exports = { leggiDatiProdottoCardmarket, linguaProbabile };
