// Content script sul Ledger (la pagina GitHub Pages della collezione):
// aggiunge "Metti in vetrina" nella scheda di dettaglio di ogni carta.
// Il pulsante esiste solo nel browser con l'estensione installata: chi apre
// il Ledger senza estensione non lo vede.
//
// I dati arrivano dalla lista "carte" del tracker (chrome.storage.local),
// cercata per link: nome, immagine, filtro e ultimo prezzo di mercato.
// Codice ed espansione sono ricavati dall'URL e restano modificabili.

const STILE_VETRINA = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .velo {
    position: fixed; inset: 0; z-index: 2147483001; background: rgba(5,8,18,.6);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  form {
    background: #141b31; color: #ece7da; border: 1px solid rgba(201,163,95,.3); border-radius: 6px;
    width: min(440px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 18px;
    font-size: 14px; display: grid; gap: 10px;
  }
  h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #e5c584; }
  .testa { display: flex; gap: 12px; align-items: flex-start; }
  .testa img { width: 72px; border-radius: 3px; background: #1c2440; }
  .nota { font-size: 12.5px; color: #9aa3bb; }
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
  @media (max-width: 420px) { .riga { grid-template-columns: 1fr 1fr; } }
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

function euroBreve(v) {
  return v.toFixed(2).replace(".", ",") + " €";
}

// La radice shadow ospita il modulo, isolato dagli stili del Ledger.
function radiceModulo() {
  let host = document.getElementById("cm-tracker-vetrina");
  if (!host) {
    host = document.createElement("div");
    host.id = "cm-tracker-vetrina";
    const radice = host.attachShadow({ mode: "open" });
    const stile = document.createElement("style");
    stile.textContent = STILE_VETRINA;
    radice.append(stile);
    document.documentElement.append(host);
  }
  return host.shadowRoot;
}

async function apriModuloVetrina(link) {
  const { carte = [] } = await chrome.storage.local.get("carte");
  const tracciata = carte.find((c) => c.link === link);
  if (!tracciata) {
    alert("Questa carta non è nella lista del tracker su questo browser: aggiungila dal popup dell'estensione.");
    return;
  }
  const dati = datiDaCartaTracciata(tracciata);
  const mercato = mercatoDaCartaTracciata(tracciata);
  const radice = radiceModulo();

  const nota = mercato
    ? `Prezzo di mercato dall'ultimo controllo: ${euroBreve(mercato.marketPrice)}` +
      (tracciata.filtroInfo ? ` (filtro "${tracciata.filtroInfo}")` : "") + "."
    : "Nessun prezzo di mercato recente: verrà calcolato con \"Aggiorna prezzi\".";

  const form = creaElemento("form", {}, [
    creaElemento("div", { class: "testa" }, [
      tracciata.immagine ? creaElemento("img", { src: tracciata.immagine, alt: "" }) : "",
      creaElemento("div", {}, [
        creaElemento("h2", { testo: "Metti in vetrina" }),
        creaElemento("div", { class: "nota", testo: nota }),
      ]),
    ]),
    campoTesto("Nome mostrato agli amici", "nome", dati.nome, { required: "" }),
    creaElemento("div", { class: "due" }, [
      campoTesto("Codice", "codice", dati.codice),
      campoTesto("Rarità", "rarita", dati.rarita),
    ]),
    campoTesto("Espansione", "espansione", dati.espansione),
    creaElemento("div", { class: "riga" }, [
      campoScelta("Condizione", "condizione", VETRINA_CONDIZIONI, "NM"),
      campoScelta("Lingua", "lingua", VETRINA_LINGUE, dati.lingua),
      campoTesto("Quantità", "quantita", "1", {
        type: "number", min: "1", step: "1", required: "",
        ...(tracciata.quantita > 0 ? { max: String(tracciata.quantita) } : {}),
      }),
    ]),
    creaElemento("div", { class: "esito", "data-esito": "" }),
    creaElemento("div", { class: "azioni" }, [
      creaElemento("button", { type: "button", class: "secondario", "data-chiudi": "", testo: "Annulla" }),
      creaElemento("button", { type: "submit", class: "primario", testo: "Aggiungi" }),
    ]),
  ]);
  const velo = creaElemento("div", { class: "velo" }, [form]);
  radice.append(velo);
  form.querySelector("input[name=nome]").focus();

  // Esc chiude solo il modulo, non anche la scheda del Ledger sotto: lo
  // intercetto in cattura su window, prima del gestore del Ledger, anche
  // quando il focus non è più dentro il modulo.
  const suEsc = (e) => {
    if (e.key !== "Escape") return;
    e.stopImmediatePropagation();
    e.preventDefault();
    chiudi();
  };
  const chiudi = () => {
    velo.remove();
    window.removeEventListener("keydown", suEsc, true);
  };
  window.addEventListener("keydown", suEsc, true);
  velo.addEventListener("click", (e) => { if (e.target === velo) chiudi(); });
  form.querySelector("[data-chiudi]").addEventListener("click", chiudi);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const esito = await aggiungiAllaVetrina(
      {
        ...dati,
        nome: f.get("nome"),
        codice: f.get("codice"),
        rarita: f.get("rarita"),
        espansione: f.get("espansione"),
        condizione: f.get("condizione"),
        lingua: f.get("lingua"),
        quantita: f.get("quantita"),
      },
      mercato
    );
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

// Se la stessa carta (URL, filtro, condizione, lingua) è già in vetrina e
// non venduta, aumento la quantità invece di creare un doppione.
async function aggiungiAllaVetrina(dati, mercato) {
  const { vetrina = [] } = await chrome.storage.local.get("vetrina");
  const nuova = nuovaCartaVetrina(dati);
  const esistente = vetrina.find(
    (c) => c.url === nuova.url && (c.filtroInfo || null) === nuova.filtroInfo &&
      c.condizione === nuova.condizione && c.lingua === nuova.lingua && !c.sold
  );
  if (esistente) {
    esistente.quantita += nuova.quantita;
    esistente.updatedAt = Date.now();
    await chrome.storage.local.set({ vetrina });
    return `Era già in vetrina: quantità portata a ${esistente.quantita}.`;
  }
  vetrina.push(mercato ? { ...nuova, ...mercato } : nuova);
  await chrome.storage.local.set({ vetrina });
  return "Aggiunta alla vetrina.";
}

// La scheda di dettaglio del Ledger viene ricostruita a ogni apertura: la
// osservo e aggiungo il pulsante accanto a "Apri la pagina su Cardmarket".
function aggiungiPulsante(scheda) {
  const apri = scheda.querySelector("a.apri:not([data-vetrina])");
  if (!apri || scheda.querySelector("a.apri[data-vetrina]")) return;
  const pulsante = creaElemento("a", {
    class: "apri", href: "#", role: "button", "data-vetrina": "", testo: "Metti in vetrina",
  });
  pulsante.style.marginLeft = "22px";
  pulsante.addEventListener("click", (e) => {
    e.preventDefault();
    apriModuloVetrina(apri.getAttribute("href"));
  });
  apri.after(pulsante);
}

const schedaLedger = document.getElementById("scheda");
if (schedaLedger && typeof chrome !== "undefined" && chrome.storage) {
  new MutationObserver(() => aggiungiPulsante(schedaLedger)).observe(schedaLedger, { childList: true });
  aggiungiPulsante(schedaLedger);
}
