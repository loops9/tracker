// Backup completo dei dati dell'estensione (chrome.storage.local), per
// portarli su un altro PC: carte tracciate, storico prezzi, vetrina e
// impostazioni GitHub. Logica pura, usata da popup, content script del
// Ledger e test Node.
//
// Formato del file:
//   { formato: "cardmarket-tracker-backup", versione: 1, esportatoIl, dati: {…} }
// In importazione è accettato anche il vecchio file del popup ({ carte, storico }).

const BACKUP_FORMATO = "cardmarket-tracker-backup";
const BACKUP_VERSIONE = 1;

// Chiavi copiate nel backup. Restano fuori quelle di passaggio
// (vetrinaProgresso) e, se non richiesto, il token.
const BACKUP_CHIAVI = [
  "carte",
  "storico",
  "vetrina",
  "vetrinaPubblicataIl",
  "vetrinaModificataIl",
  "ultimoControllo",
  "githubOwner",
  "githubRepo",
  "githubPath",
];
const BACKUP_CHIAVI_LISTA = ["carte", "storico", "vetrina"];

function creaBackup(dati, opzioni) {
  const conToken = !!(opzioni && opzioni.conToken);
  const copia = {};
  BACKUP_CHIAVI.forEach((k) => {
    if (dati[k] !== undefined) copia[k] = dati[k];
  });
  if (conToken && dati.githubToken) copia.githubToken = dati.githubToken;
  return {
    formato: BACKUP_FORMATO,
    versione: BACKUP_VERSIONE,
    esportatoIl: new Date().toISOString(),
    dati: copia,
  };
}

function nomeFileBackup(data) {
  const d = data || new Date();
  const due = (n) => String(n).padStart(2, "0");
  return `cardmarket-tracker-backup-${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}.json`;
}

// Dal testo del file alle chiavi da scrivere nello storage. Lancia un errore
// leggibile se il file non è un backup valido.
function leggiBackup(testo) {
  let json;
  try {
    json = JSON.parse(testo);
  } catch {
    throw new Error("il file non è un JSON valido");
  }
  if (!json || typeof json !== "object") throw new Error("il file non è un backup del tracker");

  let dati;
  if (json.formato === BACKUP_FORMATO) {
    if (json.versione > BACKUP_VERSIONE) throw new Error("il backup è di una versione più nuova dell'estensione: aggiornala prima");
    dati = json.dati || {};
  } else if (Array.isArray(json.carte)) {
    dati = { carte: json.carte, storico: json.storico }; // vecchio "Esporta lista carte"
  } else {
    throw new Error("il file non è un backup del tracker");
  }

  const daScrivere = {};
  [...BACKUP_CHIAVI, "githubToken"].forEach((k) => {
    if (dati[k] === undefined || dati[k] === null) return;
    if (BACKUP_CHIAVI_LISTA.includes(k) && !Array.isArray(dati[k])) throw new Error(`"${k}" non è una lista`);
    daScrivere[k] = dati[k];
  });
  if (!Array.isArray(daScrivere.carte)) throw new Error("il file non contiene la lista delle carte");
  if (!Array.isArray(daScrivere.storico)) daScrivere.storico = [];
  return daScrivere;
}

function riassuntoBackup(d) {
  const parti = [`${d.carte.length} carte tracciate`, `${d.storico.length} righe di storico`];
  if (Array.isArray(d.vetrina)) parti.push(`${d.vetrina.length} carte in vetrina`);
  if (d.githubOwner && d.githubRepo) parti.push(`impostazioni GitHub (${d.githubOwner}/${d.githubRepo}${d.githubToken ? ", con token" : ", senza token"})`);
  return parti.join(", ");
}

// --------------------------------------------------- funzioni per il browser

async function esportaBackup() {
  const tutto = await chrome.storage.local.get(null);
  let conToken = false;
  if (tutto.githubToken) {
    conToken = confirm(
      "Includere anche il token GitHub nel file?\n\n" +
      "OK: sì. Sul nuovo PC la pubblicazione funziona subito, ma il file va tenuto privato (dà accesso in scrittura al repository).\n" +
      "Annulla: no. Sul nuovo PC dovrai reinserire il token nelle impostazioni."
    );
  }
  const backup = creaBackup(tutto, { conToken });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeFileBackup();
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return `Esportato: ${riassuntoBackup({ carte: [], storico: [], ...backup.dati })}.`;
}

// Sostituisce i dati di questo browser con quelli del file, dopo conferma.
// Restituisce il messaggio da mostrare, o null se l'utente annulla.
async function importaBackup(file) {
  const dati = leggiBackup(await file.text());
  const { carte = [], vetrina = [] } = await chrome.storage.local.get(["carte", "vetrina"]);
  let domanda = `Importare ${riassuntoBackup(dati)}?`;
  if (carte.length || vetrina.length) {
    domanda += `\n\nI dati attuali di questo browser (${carte.length} carte, ${vetrina.length} in vetrina) verranno sostituiti.`;
  }
  if (!confirm(domanda)) return null;
  await chrome.storage.local.set(dati);
  let esito = `Importato: ${riassuntoBackup(dati)}.`;
  if (!dati.githubToken) {
    const { githubToken } = await chrome.storage.local.get("githubToken");
    if (!githubToken) esito += " Il token GitHub non era nel file: inseriscilo nelle impostazioni.";
  }
  return esito;
}

if (typeof module !== "undefined") {
  module.exports = { creaBackup, leggiBackup, riassuntoBackup, nomeFileBackup, BACKUP_FORMATO };
}
