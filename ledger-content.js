// Content script sul Ledger (la pagina GitHub Pages della collezione):
// aggiunge "Metti in vetrina" nella scheda di dettaglio di ogni carta.
// Il pulsante esiste solo nel browser con l'estensione installata: chi apre
// il Ledger senza estensione non lo vede.
//
// I dati arrivano dalla lista "carte" del tracker (chrome.storage.local),
// cercata per link: nome, immagine, filtro e ultimo prezzo di mercato.
// Codice ed espansione sono ricavati dall'URL e restano modificabili.

const STILE_VETRINA = `
  :host {
    all: initial;
    --sfondo: #f4f0e8; --superficie: #fbf8f2; --testo: #2a2520; --tenue: #776d61;
    --bordo: rgba(42,37,32,.16); --accento: #a4573a; --su-accento: #fbf8f2;
    --ok: #4e7a3f; --errore: #b2443b; --velo: rgba(42,37,32,.45);
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --sfondo: #1b1916; --superficie: #24211d; --testo: #ece6dc; --tenue: #9d9488;
      --bordo: rgba(236,230,220,.14); --accento: #c98a62; --su-accento: #1b1916;
      --ok: #8fae7e; --errore: #e07a6e; --velo: rgba(14,12,10,.72);
    }
  }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .velo {
    position: fixed; inset: 0; z-index: 2147483001; background: var(--velo);
    display: flex; align-items: center; justify-content: center; padding: 16px;
  }
  form {
    background: var(--superficie); color: var(--testo); border: 1px solid var(--bordo); border-radius: 4px;
    width: min(460px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 22px;
    font-size: 14px; display: grid; gap: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.25);
  }
  h2 { margin: 0 0 4px; font: 600 21px/1.2 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  .testa { display: flex; gap: 14px; align-items: flex-start; }
  .testa img { width: 72px; border-radius: 3px; background: var(--sfondo); }
  .nota { font-size: 13px; color: var(--tenue); }
  label { display: grid; gap: 4px; font-size: 12px; color: var(--tenue); }
  input, select {
    font-size: 14px; padding: 7px 9px; color: var(--testo); background: var(--sfondo);
    border: 1px solid var(--bordo); border-radius: 3px; width: 100%;
  }
  input:focus, select:focus { outline: 2px solid var(--accento); outline-offset: 0; }
  input:disabled, select:disabled { opacity: .6; }
  .riga { display: grid; grid-template-columns: 1fr 1fr 80px; gap: 8px; }
  .due { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .azioni { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
  button { font-size: 14px; padding: 8px 14px; border-radius: 3px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .primario { background: var(--accento); color: var(--su-accento); border: 1px solid var(--accento); font-weight: 600; }
  .secondario { background: none; color: var(--testo); border: 1px solid var(--bordo); }
  .esito { font-size: 13.5px; color: var(--tenue); min-height: 1em; white-space: pre-line; }
  .esito.ok { color: var(--ok); }
  .esito.avviso { color: var(--testo); }
  .esito.errore { color: var(--errore); }
  .esito a { color: var(--accento); font-weight: 600; }
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
      creaElemento("button", { type: "submit", class: "secondario", value: "solo", testo: "Solo aggiungi" }),
      creaElemento("button", { type: "submit", class: "primario", value: "pubblica", testo: "Aggiungi e pubblica" }),
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
    const pubblica = e.submitter?.value !== "solo";
    const f = new FormData(form);
    form.querySelectorAll("button[type=submit], input, select").forEach((el) => (el.disabled = true));
    const box = form.querySelector("[data-esito]");
    const scrivi = (testo, tipo) => {
      box.className = "esito" + (tipo ? " " + tipo : "");
      box.textContent = testo;
    };

    const aggiunta = await aggiungiAllaVetrina(
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
    segnaInVetrina();

    if (!pubblica) {
      scrivi(aggiunta + " La pagina pubblica cambierà solo quando pubblichi la vetrina.");
    } else {
      scrivi(aggiunta + " Pubblicazione in corso…");
      const r = await chrome.runtime.sendMessage({ tipo: "pubblicaVetrina" });
      if (r?.ok) {
        const avvisi = r.avvisi?.length ? "\nAttenzione: " + r.avvisi.join("; ") + "." : "";
        scrivi(`✓ ${aggiunta} Vetrina pubblicata (${r.pubblicate} carte): sarà visibile tra circa un minuto.${avvisi}\n`, avvisi ? "avviso" : "ok");
        const vai = creaElemento("a", { href: r.url, target: "_blank", rel: "noopener", testo: "Apri la vetrina" });
        box.append(vai);
      } else {
        scrivi(`${aggiunta} Pubblicazione non riuscita: ${r?.errore || "errore sconosciuto"}`, "errore");
      }
    }
    box.append(" · ");
    const gestione = creaElemento("a", { href: "#", testo: "Gestione vetrina" });
    gestione.addEventListener("click", (ev) => {
      ev.preventDefault();
      chrome.runtime.sendMessage({ tipo: "apriOpzioni" });
    });
    box.append(gestione);
    form.querySelector("[data-chiudi]").disabled = false;
    form.querySelector("[data-chiudi]").textContent = "Chiudi";
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
    await chrome.storage.local.set({ vetrina, vetrinaModificataIl: Date.now() });
    return `Era già in vetrina: quantità portata a ${esistente.quantita}.`;
  }
  vetrina.push(mercato ? { ...nuova, ...mercato } : nuova);
  await chrome.storage.local.set({ vetrina, vetrinaModificataIl: Date.now() });
  return "Aggiunta alla vetrina.";
}

// La scheda di dettaglio del Ledger viene ricostruita a ogni apertura: la
// osservo e aggiungo il pulsante accanto a "Apri la pagina su Cardmarket".
function aggiungiPulsante(scheda) {
  const apri = scheda.querySelector("a.apri:not([data-vetrina])");
  if (!apri || scheda.querySelector("a.apri[data-vetrina]")) return;
  const link = apri.getAttribute("href");
  const pulsante = creaElemento("a", {
    class: "apri", href: "#", role: "button", "data-vetrina": "", "data-link": link, testo: "Metti in vetrina",
  });
  pulsante.style.marginLeft = "22px";
  pulsante.addEventListener("click", (e) => {
    e.preventDefault();
    apriModuloVetrina(link);
  });
  apri.after(pulsante);
  segnaInVetrina();
}

// "✓ In vetrina" sulle carte già presenti (non vendute).
async function segnaInVetrina() {
  const pulsante = document.querySelector("#scheda a[data-vetrina]");
  if (!pulsante) return;
  const { vetrina = [] } = await chrome.storage.local.get("vetrina");
  const presenti = vetrina.filter((c) => c.url === normalizzaUrlProdotto(pulsante.dataset.link) && !c.sold);
  const pezzi = presenti.reduce((s, c) => s + (c.quantita || 1), 0);
  pulsante.textContent = pezzi ? `✓ In vetrina (${pezzi}) · aggiungi` : "Metti in vetrina";
}

const schedaLedger = document.getElementById("scheda");
if (schedaLedger && typeof chrome !== "undefined" && chrome.storage) {
  new MutationObserver(() => aggiungiPulsante(schedaLedger)).observe(schedaLedger, { childList: true });
  aggiungiPulsante(schedaLedger);
}
