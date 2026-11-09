const righe = document.getElementById("righe");
const stato = document.getElementById("stato");
const btnAggiorna = document.getElementById("btnAggiorna");
const btnPubblica = document.getElementById("btnPubblica");

document.getElementById("soglia").textContent = VETRINA_SOGLIA_SCOSTAMENTO;

function euro(v) {
  return v == null ? "—" : v.toFixed(2).replace(".", ",") + " €";
}

function dataBreve(ts) {
  return ts ? new Date(ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "";
}

function scriviStato(testo, tipo) {
  stato.textContent = testo;
  stato.className = tipo || "";
}

function crea(tag, classe, testo) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (testo != null) el.textContent = testo;
  return el;
}

// Ogni modifica rilegge la lista: il service worker può averla aggiornata
// nel frattempo (aggiornamento prezzi in corso).
async function modifica(id, cambia) {
  const { vetrina = [] } = await chrome.storage.local.get("vetrina");
  const i = vetrina.findIndex((c) => c.id === id);
  if (i === -1) return;
  const nuova = cambia({ ...vetrina[i] });
  if (nuova === null) vetrina.splice(i, 1);
  else vetrina[i] = { ...nuova, updatedAt: Date.now() };
  await chrome.storage.local.set({ vetrina });
}

function cellaMercato(c) {
  const td = crea("td", "num");
  td.append(crea("span", "", euro(c.marketPrice)));
  let nota;
  const problema = c.marketStato && c.marketStato !== "ok";
  if (problema) nota = c.marketStato;
  else if (c.marketSampleSize < 3) nota = `solo ${c.marketSampleSize} inserzion${c.marketSampleSize === 1 ? "e" : "i"}`;
  else nota = dataBreve(c.marketAggiornatoIl);
  if (problema && c.marketPrice != null && c.marketAggiornatoIl) nota += " · prezzo del " + dataBreve(c.marketAggiornatoIl);
  const sp = crea("span", "stato-mercato" + (problema || c.marketSampleSize < 3 ? " problema" : ""), nota);
  td.append(sp);
  return td;
}

function riga(c) {
  const tr = crea("tr", c.sold ? "venduta" : "");
  tr.dataset.id = c.id;

  const tdImg = crea("td", "miniatura");
  if (c.immagineUrl) {
    const img = document.createElement("img");
    img.src = c.immagineUrl; // dall'estensione il Referer viene riscritto, quindi si carica
    img.alt = "";
    img.loading = "lazy";
    tdImg.append(img);
  } else {
    tdImg.append(crea("span", "vuota"));
  }

  const tdCarta = crea("td");
  const nome = crea("div", "nome");
  const a = crea("a", "", c.nome || "(senza nome)");
  a.href = c.url;
  a.target = "_blank";
  a.rel = "noopener";
  nome.append(a);
  tdCarta.append(
    nome,
    crea("div", "dettagli", [c.codice, c.espansione, c.rarita, c.condizione, c.lingua].filter(Boolean).join(" · "))
  );

  const tdQta = crea("td", "num");
  const qta = document.createElement("input");
  qta.type = "number";
  qta.min = "1";
  qta.step = "1";
  qta.value = c.quantita;
  qta.dataset.campo = "quantita";
  qta.setAttribute("aria-label", "Quantità");
  tdQta.append(qta);

  const tdCustom = crea("td", "num");
  const custom = document.createElement("input");
  custom.className = "prezzo";
  custom.inputMode = "decimal";
  custom.placeholder = c.marketPrice != null ? c.marketPrice.toFixed(2).replace(".", ",") : "—";
  custom.value = c.customPrice != null ? c.customPrice.toFixed(2).replace(".", ",") : "";
  custom.dataset.campo = "customPrice";
  custom.setAttribute("aria-label", "Prezzo personale (vuoto = prezzo di mercato)");
  custom.title = "Vuoto = usa il prezzo di mercato";
  tdCustom.append(custom);

  const s = scostamentoPct(c);
  const tdScost = crea("td", "num scost" + (scostamentoAlto(c) ? " alto" : ""),
    s == null ? "" : (s > 0 ? "+" : "") + s.toFixed(0) + "%");

  const tdMostrato = crea("td", "num mostrato", euro(prezzoMostrato(c)));

  const tdSold = crea("td");
  const sold = document.createElement("input");
  sold.type = "checkbox";
  sold.checked = !!c.sold;
  sold.dataset.campo = "sold";
  sold.setAttribute("aria-label", "Venduta");
  tdSold.append(sold);

  const tdAzioni = crea("td", "azioni");
  const agg = crea("button", "", "↻");
  agg.title = "Aggiorna il prezzo di questa carta";
  agg.dataset.azione = "aggiorna";
  const rim = crea("button", "", "✕");
  rim.title = "Togli dalla vetrina";
  rim.dataset.azione = "rimuovi";
  tdAzioni.append(agg, rim);

  tr.append(tdImg, tdCarta, tdQta, cellaMercato(c), tdCustom, tdScost, tdMostrato, tdSold, tdAzioni);
  return tr;
}

async function ricarica() {
  const { vetrina = [], vetrinaPubblicataIl, githubOwner, githubRepo } = await chrome.storage.local.get([
    "vetrina", "vetrinaPubblicataIl", "githubOwner", "githubRepo",
  ]);

  // non perdere ciò che si sta scrivendo se la tabella viene ridisegnata
  const attivo = document.activeElement;
  const fuoco = attivo && attivo.dataset && attivo.dataset.campo
    ? { id: attivo.closest("tr").dataset.id, campo: attivo.dataset.campo, valore: attivo.value }
    : null;

  righe.replaceChildren();
  if (!vetrina.length) {
    const tr = crea("tr", "vuoto");
    const td = crea("td", "", "La vetrina è vuota.");
    td.colSpan = 9;
    tr.append(td);
    righe.append(tr);
  }
  // in vendita prima, vendute in fondo, come nella pagina pubblica
  [...vetrina].sort((a, b) => Number(!!a.sold) - Number(!!b.sold)).forEach((c) => righe.append(riga(c)));

  if (fuoco) {
    const el = righe.querySelector(`tr[data-id="${CSS.escape(fuoco.id)}"] [data-campo="${fuoco.campo}"]`);
    if (el && el.type !== "checkbox") {
      el.value = fuoco.valore;
      el.focus();
    }
  }

  const inVendita = vetrina.filter((c) => !c.sold);
  const pezzi = inVendita.reduce((s, c) => s + (c.quantita || 1), 0);
  document.getElementById("riepilogo").textContent =
    `${inVendita.length} carte in vendita (${pezzi} pezzi)` +
    (vetrinaPubblicataIl ? ` · pubblicata il ${dataBreve(vetrinaPubblicataIl)}` : " · mai pubblicata");

  const link = document.getElementById("linkVetrina");
  if (githubOwner && githubRepo) {
    link.href = `https://${githubOwner.toLowerCase()}.github.io/${githubRepo}/vetrina/`;
    link.hidden = false;
  } else {
    link.hidden = true;
  }
}

righe.addEventListener("change", async (e) => {
  const el = e.target;
  const campo = el.dataset.campo;
  if (!campo) return;
  const id = el.closest("tr").dataset.id;

  if (campo === "customPrice") {
    const valore = leggiPrezzoInput(el.value);
    if (Number.isNaN(valore)) {
      el.classList.add("invalido");
      scriviStato("Prezzo non valido: usa un numero maggiore di zero, ad esempio 12,50. Lascia vuoto per il prezzo di mercato.", "errore");
      return;
    }
    el.classList.remove("invalido");
    scriviStato("");
    el.blur();
    await modifica(id, (c) => ({ ...c, customPrice: valore }));
  } else if (campo === "quantita") {
    const q = parseInt(el.value, 10);
    if (!(q >= 1)) {
      el.classList.add("invalido");
      scriviStato("La quantità deve essere almeno 1. Per una carta esaurita usa \"Venduta\".", "errore");
      return;
    }
    el.classList.remove("invalido");
    scriviStato("");
    el.blur();
    await modifica(id, (c) => ({ ...c, quantita: q }));
  } else if (campo === "sold") {
    await modifica(id, (c) => ({ ...c, sold: el.checked }));
  }
});

righe.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-azione]");
  if (!btn) return;
  const id = btn.closest("tr").dataset.id;

  if (btn.dataset.azione === "rimuovi") {
    const { vetrina = [] } = await chrome.storage.local.get("vetrina");
    const c = vetrina.find((x) => x.id === id);
    if (!c || !confirm(`Togliere "${c.nome}" dalla vetrina?`)) return;
    await modifica(id, () => null);
    scriviStato("Carta tolta. Pubblica la vetrina per toglierla anche dalla pagina.");
  }
  if (btn.dataset.azione === "aggiorna") {
    btn.disabled = true;
    scriviStato("Aggiornamento del prezzo in corso…");
    const r = await chrome.runtime.sendMessage({ tipo: "aggiornaVetrina", id });
    scriviStato(r?.ok ? descriviEsito(r) : "Errore: " + (r?.errore || "riprova"), tipoEsito(r));
    btn.disabled = false;
  }
});

function tipoEsito(r) {
  if (!r?.ok) return "errore";
  return r.bloccate || r.errori ? "" : "ok";
}

function descriviEsito(r) {
  const parti = [`${r.aggiornate} aggiornate`];
  if (r.senzaInserzioni) parti.push(`${r.senzaInserzioni} senza inserzioni italiane`);
  if (r.bloccate) parti.push(`${r.bloccate} bloccate da Cloudflare (riprova più tardi)`);
  if (r.errori) parti.push(`${r.errori} con errori`);
  return "Prezzi: " + parti.join(", ") + ".";
}

btnAggiorna.addEventListener("click", async () => {
  btnAggiorna.disabled = true;
  scriviStato("Aggiornamento prezzi in corso: le pagine di Cardmarket si aprono in background, qualcuna alla volta: puoi continuare a lavorare.");
  const r = await chrome.runtime.sendMessage({ tipo: "aggiornaVetrina" });
  scriviStato(r?.ok ? descriviEsito(r) : "Errore: " + (r?.errore || "riprova"), tipoEsito(r));
  btnAggiorna.disabled = false;
});

btnPubblica.addEventListener("click", async () => {
  btnPubblica.disabled = true;
  scriviStato("Pubblicazione in corso…");
  const r = await chrome.runtime.sendMessage({ tipo: "pubblicaVetrina" });
  if (r?.ok) {
    let testo = `Vetrina pubblicata: ${r.pubblicate} carte. GitHub Pages impiega circa un minuto ad aggiornare la pagina.`;
    if (r.avvisi?.length) testo += "\nAttenzione:\n· " + r.avvisi.join("\n· ");
    scriviStato(testo, r.avvisi?.length ? "" : "ok");
  } else {
    scriviStato("Pubblicazione non riuscita: " + (r?.errore || "errore sconosciuto"), "errore");
  }
  btnPubblica.disabled = false;
});

chrome.storage.onChanged.addListener((cambi, area) => {
  if (area !== "local") return;
  if (cambi.vetrinaProgresso?.newValue?.inCorso) {
    const p = cambi.vetrinaProgresso.newValue;
    scriviStato(`Aggiornamento prezzi: ${p.fatte} di ${p.totale} pagine lette…`);
  }
  if (cambi.vetrina || cambi.vetrinaPubblicataIl || cambi.githubOwner || cambi.githubRepo) ricarica();
});

// ------------------------------------------------------------ impostazioni

(async () => {
  const { githubOwner, githubRepo, githubToken } = await chrome.storage.local.get([
    "githubOwner", "githubRepo", "githubToken",
  ]);
  document.getElementById("inputGithubOwner").value = githubOwner || "";
  document.getElementById("inputGithubRepo").value = githubRepo || "";
  document.getElementById("inputGithubToken").value = githubToken || "";
  if (!githubToken) document.getElementById("impostazioni").open = true;
})();

document.getElementById("btnSalvaImpostazioni").addEventListener("click", async () => {
  await chrome.storage.local.set({
    githubOwner: document.getElementById("inputGithubOwner").value.trim(),
    githubRepo: document.getElementById("inputGithubRepo").value.trim(),
    githubToken: document.getElementById("inputGithubToken").value.trim(),
  });
  scriviStato("Impostazioni salvate.", "ok");
});

// prima di disegnare le miniature mi assicuro che la regola sul Referer sia attiva
chrome.runtime.sendMessage({ tipo: "preparaImmagini" }).catch(() => {}).finally(ricarica);
