const corpo = document.getElementById("tabellaCarte");
const stato = document.getElementById("stato");

async function ricarica() {
  const { carte = [] } = await chrome.storage.local.get("carte");
  corpo.innerHTML = "";

  if (carte.length === 0) {
    corpo.innerHTML = '<tr><td colspan="3" class="vuoto">Nessuna carta aggiunta</td></tr>';
    return;
  }

  carte.forEach((c, i) => {
    const tr = document.createElement("tr");

    const tdNome = document.createElement("td");
    const q = c.quantita && c.quantita > 1 ? ` x${c.quantita}` : "";
    tdNome.textContent = (c.filtroInfo ? `${c.nome} (${c.filtroInfo})` : c.nome) + q;
    if (c.immagineStato) tdNome.title = "immagine: " + c.immagineStato;

    const tdPrezzo = document.createElement("td");
    tdPrezzo.className = "prezzo";
    if (c.ultimoPrezzo != null) {
      const dataStr = new Date(c.ultimaData).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
      tdPrezzo.innerHTML = `${c.ultimoPrezzo.toFixed(2)} €<br><span class="data">${dataStr}</span>`;
    } else if (c.ultimoBloccato) {
      tdPrezzo.innerHTML = '<span class="vuoto" title="Cardmarket ha mostrato una pagina di verifica anti-bot invece del contenuto">bloccato (anti-bot)</span>';
    } else if (c.ultimoErrore) {
      tdPrezzo.innerHTML = `<span class="vuoto" title="${c.ultimoErrore}">errore</span>`;
    } else {
      tdPrezzo.innerHTML = '<span class="vuoto">—</span>';
    }

    const tdAzioni = document.createElement("td");
    tdAzioni.className = "azioni";

    const btnRicontrolla = document.createElement("span");
    btnRicontrolla.className = "ricontrolla";
    btnRicontrolla.textContent = "↻";
    btnRicontrolla.title = "Ricontrolla solo questa carta";
    btnRicontrolla.dataset.link = c.link;

    const btnRimuovi = document.createElement("span");
    btnRimuovi.className = "rimuovi";
    btnRimuovi.textContent = "✕";
    btnRimuovi.title = "Rimuovi questa carta";
    btnRimuovi.dataset.i = i;

    tdAzioni.append(btnRicontrolla, btnRimuovi);
    tr.append(tdNome, tdPrezzo, tdAzioni);
    corpo.appendChild(tr);
  });
}

document.getElementById("btnAggiungi").addEventListener("click", async () => {
  const inputNome = document.getElementById("inputNome");
  const inputLink = document.getElementById("inputLink");
  const inputFiltro = document.getElementById("inputFiltro");
  const inputQuantita = document.getElementById("inputQuantita");
  const nome = inputNome.value.trim();
  const link = inputLink.value.trim();
  const filtroInfo = inputFiltro.value.trim();
  const quantita = Math.max(1, parseInt(inputQuantita.value, 10) || 1);
  if (!nome || !link) {
    stato.textContent = "Inserisci nome e link.";
    return;
  }
  if (!link.includes("cardmarket.com")) {
    stato.textContent = "Il link non sembra un link Cardmarket.";
    return;
  }

  const { carte = [] } = await chrome.storage.local.get("carte");
  carte.push({
    nome,
    link,
    filtroInfo: filtroInfo || null,
    quantita,
    ultimoPrezzo: null,
    ultimaData: null,
    ultimoErrore: null,
    ultimoBloccato: false,
  });
  await chrome.storage.local.set({ carte });

  inputNome.value = "";
  inputLink.value = "";
  inputFiltro.value = "";
  inputQuantita.value = "1";
  stato.textContent = "";
  ricarica();
});

corpo.addEventListener("click", async (e) => {
  if (e.target.classList.contains("rimuovi")) {
    const i = Number(e.target.dataset.i);
    const { carte = [] } = await chrome.storage.local.get("carte");
    const nome = carte[i]?.nome || "questa carta";
    if (!confirm(`Rimuovere "${nome}" dalla lista?`)) return;
    carte.splice(i, 1);
    await chrome.storage.local.set({ carte });
    ricarica();
    return;
  }

  if (e.target.classList.contains("ricontrolla")) {
    const btn = e.target;
    if (btn.getAttribute("aria-disabled") === "true") return;
    const link = btn.dataset.link;
    btn.setAttribute("aria-disabled", "true");
    btn.textContent = "…";
    stato.textContent = "Ricontrollo di una carta in corso...";
    chrome.runtime.sendMessage({ tipo: "controllaUna", link }, (r) => {
      if (r?.ok) {
        stato.textContent = r.bloccato
          ? "Ricontrollo fatto, ma Cardmarket ha mostrato la pagina anti-bot."
          : "Carta ricontrollata.";
      } else {
        stato.textContent = "Errore nel ricontrollo: " + (r?.errore || "riprova");
      }
      ricarica();
    });
    return;
  }
});

document.getElementById("btnControlla").addEventListener("click", () => {
  stato.textContent = "Controllo in corso... puoi anche chiudere questo popup, continua in background.";
  chrome.runtime.sendMessage({ tipo: "controllaOra" }, () => {
    stato.textContent = "Controllo completato.";
    ricarica();
  });
});

document.getElementById("btnEsporta").addEventListener("click", async () => {
  const { storico = [] } = await chrome.storage.local.get("storico");
  if (storico.length === 0) {
    stato.textContent = "Nessuno storico da esportare ancora.";
    return;
  }

  let csv = "Data,Nome carta,Prezzo IT (EUR)\n";
  storico.forEach((r) => {
    const dataStr = new Date(r.data).toISOString().slice(0, 16).replace("T", " ");
    const nomeSicuro = String(r.nome).replace(/"/g, '""');
    csv += `"${dataStr}","${nomeSicuro}",${r.prezzo}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "storico_prezzi_onepiece.csv";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnStorico").addEventListener("click", async () => {
  const container = document.getElementById("storicoContainer");
  const btn = document.getElementById("btnStorico");
  const giaVisibile = container.style.display !== "none";

  if (giaVisibile) {
    container.style.display = "none";
    btn.textContent = "Mostra storico";
    return;
  }

  const { storico = [] } = await chrome.storage.local.get("storico");
  const corpoStorico = document.querySelector("#tabellaStorico tbody");
  corpoStorico.innerHTML = "";

  if (storico.length === 0) {
    corpoStorico.innerHTML = '<tr><td colspan="3" class="vuoto">Ancora nessun dato storico</td></tr>';
  } else {
    [...storico].reverse().slice(0, 30).forEach((r) => {
      const tr = document.createElement("tr");
      const dataStr = new Date(r.data).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
      const tdData = document.createElement("td");
      tdData.className = "data";
      tdData.textContent = dataStr;
      const tdNome = document.createElement("td");
      tdNome.textContent = r.nome;
      const tdPrezzo = document.createElement("td");
      tdPrezzo.className = "prezzo";
      tdPrezzo.textContent = `${r.prezzo.toFixed(2)} €`;
      tr.append(tdData, tdNome, tdPrezzo);
      corpoStorico.appendChild(tr);
    });
  }

  container.style.display = "block";
  btn.textContent = "Nascondi storico";
});

document.getElementById("btnEsportaConfig").addEventListener("click", async () => {
  const dati = await chrome.storage.local.get(["carte", "storico"]);
  const blob = new Blob([JSON.stringify(dati, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cardmarket_tracker_backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnImportaConfig").addEventListener("click", () => {
  document.getElementById("inputImporta").click();
});

document.getElementById("inputImporta").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const testo = await file.text();
    const dati = JSON.parse(testo);
    if (!Array.isArray(dati.carte)) throw new Error("il file non contiene una lista carte valida");

    const confermato = confirm(
      `Importare ${dati.carte.length} carte e ${Array.isArray(dati.storico) ? dati.storico.length : 0} righe di storico? La lista attuale verrà sostituita.`
    );
    if (!confermato) {
      e.target.value = "";
      return;
    }

    await chrome.storage.local.set({
      carte: dati.carte,
      storico: Array.isArray(dati.storico) ? dati.storico : [],
    });
    stato.textContent = "Importazione completata.";
    ricarica();
  } catch (err) {
    stato.textContent = "Errore nell'importazione: " + err.message;
  }
  e.target.value = "";
});

document.getElementById("btnImpostazioni").addEventListener("click", async () => {
  const container = document.getElementById("impostazioniContainer");
  const visibile = container.style.display !== "none";
  if (visibile) {
    container.style.display = "none";
    return;
  }
  const { githubOwner, githubRepo, githubToken } = await chrome.storage.local.get([
    "githubOwner",
    "githubRepo",
    "githubToken",
  ]);
  document.getElementById("inputGithubOwner").value = githubOwner || "";
  document.getElementById("inputGithubRepo").value = githubRepo || "";
  document.getElementById("inputGithubToken").value = githubToken || "";
  container.style.display = "block";
});

document.getElementById("btnSalvaImpostazioni").addEventListener("click", async () => {
  const githubOwner = document.getElementById("inputGithubOwner").value.trim();
  const githubRepo = document.getElementById("inputGithubRepo").value.trim();
  const githubToken = document.getElementById("inputGithubToken").value.trim();
  await chrome.storage.local.set({ githubOwner, githubRepo, githubToken });
  stato.textContent = "Impostazioni salvate.";
});

document.getElementById("btnSincronizzaOra").addEventListener("click", () => {
  stato.textContent = "Sincronizzazione in corso...";
  chrome.runtime.sendMessage({ tipo: "sincronizzaOra" }, (risposta) => {
    stato.textContent = risposta?.ok
      ? "Sincronizzato su GitHub."
      : "Errore sincronizzazione: " + (risposta?.errore || "controlla utente/repo/token");
  });
});

ricarica();
