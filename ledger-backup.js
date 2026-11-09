// Content script sul Ledger: "Esporta dati" / "Importa dati" sotto il titolo.
// Visibile solo nel browser con l'estensione (chi apre il Ledger senza
// estensione non lo vede). Logica in backup.js.
//
// Lo shadow DOM isola gli stili; le variabili CSS del Ledger (--oro, --tenue…)
// passano comunque, così i colori seguono il tema chiaro/scuro della pagina.

const STILE_BACKUP = `
  :host { all: initial; display: block; margin: 10px 0 22px; }
  * { box-sizing: border-box; font-family: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif); }
  .fila { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; font-size: 12.5px; color: var(--tenue, #776d61); }
  button {
    font-size: 12.5px; padding: 5px 11px; border-radius: 3px; cursor: pointer;
    background: none; color: var(--testo, #2a2520); border: 1px solid var(--filo, rgba(42,37,32,.16));
  }
  button:hover { border-color: var(--oro, #a4573a); color: var(--oro, #a4573a); }
  button:focus-visible { outline: 2px solid var(--oro, #a4573a); outline-offset: 2px; }
  button:disabled { opacity: .5; cursor: default; }
  .esito { white-space: pre-line; }
  .esito.ok { color: var(--sale, #4e7a3f); }
  .esito.errore { color: var(--scende, #b2443b); }
`;

function montaBackupLedger() {
  const riga = document.querySelector(".testata-riga");
  if (!riga || document.getElementById("cm-tracker-backup")) return;

  const host = document.createElement("div");
  host.id = "cm-tracker-backup";
  const radice = host.attachShadow({ mode: "open" });
  radice.innerHTML = `
    <style>${STILE_BACKUP}</style>
    <div class="fila">
      <span>Dati dell'estensione:</span>
      <button type="button" data-esporta title="Scarica un file con carte, storico, vetrina e impostazioni, da importare su un altro PC">Esporta dati</button>
      <button type="button" data-importa title="Carica un file di backup esportato da un altro PC">Importa dati</button>
      <input type="file" accept="application/json,.json" hidden>
      <span class="esito" role="status" aria-live="polite"></span>
    </div>`;
  riga.after(host);

  const esito = radice.querySelector(".esito");
  const scrivi = (testo, tipo) => {
    esito.textContent = testo;
    esito.className = "esito" + (tipo ? " " + tipo : "");
  };
  const input = radice.querySelector("input[type=file]");

  radice.querySelector("[data-esporta]").addEventListener("click", async () => {
    try {
      scrivi(await esportaBackup(), "ok");
    } catch (err) {
      scrivi("Esportazione non riuscita: " + err.message, "errore");
    }
  });
  radice.querySelector("[data-importa]").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    try {
      const r = await importaBackup(file);
      if (r) scrivi(r, "ok");
    } catch (err) {
      scrivi("Importazione non riuscita: " + err.message, "errore");
    }
  });
}

if (typeof chrome !== "undefined" && chrome.storage) montaBackupLedger();
