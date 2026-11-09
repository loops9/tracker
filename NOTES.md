# Note di progetto

## Architettura attuale (prima della vetrina)

**Estensione Chrome (Manifest V3)**, caricata "non pacchettizzata" dalla radice del repo.

| File | Ruolo |
|---|---|
| `manifest.json` | permessi `storage, tabs, scripting, alarms, declarativeNetRequest`; host `*.cardmarket.com`, `api.github.com`. Nessun content script, nessuna pagina options. |
| `background.js` | service worker: tutto il lavoro (scraping, miniature, sync GitHub). |
| `popup.html/js` | lista carte tracciate (`carte`), aggiunta manuale nome+link, controllo, CSV, backup, impostazioni GitHub. |
| `filtro.js` + `filtro.test.js` | normalizzazione del filtro "PSA 10". **Non è usato** da `background.js`, che ha una sua normalizzazione più semplice (inline in `estraiPrezzoMinimoItalia`). |
| `index.html` + `sw.js` | pagina "Cardmarket Ledger" su GitHub Pages: legge `data.json`. `sw.js` mette in cache tutto ciò che è same-origin (cache-first, tranne `data.json` che è network-first). |
| `data.json` | `{ carte, storico, aggiornatoIl }`, scritto dall'estensione. Le immagini sono miniature 160px **incorporate come data URL**. |

**Scraping** (`controllaCarta`): apre la pagina prodotto in una tab attiva con `?sellerCountry=17`
(Italia), aspetta `status: complete` + 5 s (margine per la sfida Cloudflare), inietta
`estraiPrezzoMinimoItalia` con `chrome.scripting.executeScript`, chiude la tab. Timeout 45 s.
Tra una carta e l'altra pausa casuale 4–9 s (`RITARDO_MIN_MS/MAX_MS`).

**Estrazione** (`estraiPrezzoMinimoItalia`, eseguita nella pagina): righe `.article-row`; paese da
`aria-label|title|data-original-title` che inizia con "Locazione" (quindi funziona solo con
l'interfaccia **in italiano**, `/it/`); prezzo da `.col-offer .price-container span.color-primary`
in formato europeo (`1.234,56 €`). Se non ci sono righe e il titolo/DOM somiglia a una sfida
Cloudflare → `bloccato: true`. Restituisce già `media3` (media dei 3 più bassi) e `nOfferte`.
Immagine: `.card-image img` con il codice carta nell'`alt`, poi `og:image`.

**Immagini**: il CDN `product-images.s3.cardmarket.com` risponde **403 senza Referer
cardmarket.com**. Verificato anche dalla VPS (9/11/2026): nessun Referer → 403, Referer
`loops9.github.io` → 403, Referer `www.cardmarket.com` → 200. L'estensione installa una regola
`declarativeNetRequest` di sessione che riscrive il Referer e scarica le immagini dal service worker.

**Pubblicazione** (`sincronizzaGitHub`): Contents API, `GET` per lo sha poi `PUT`
`/repos/{owner}/{repo}/contents/{path}` sul branch `main`, header `Bearer`. Gli errori vengono solo
loggati (il popup dice "Sincronizzato" anche se il PUT fallisce).

**Token**: già in `chrome.storage.local` (`githubOwner`, `githubRepo`, `githubToken`,
`githubPath` facoltativo). Non c'era niente da spostare.

**GitHub Pages**: build "legacy" dal branch `main`, cartella `/` → https://loops9.github.io/tracker/.
Repo pubblico.

**Controllo segreti** (9/11/2026): cercati nell'intera cronologia (`git log --all -p`) token GitHub
(`ghp_`, `gho_`, `github_pat_`…), chiavi AWS/Google/Slack, chiavi private, header `Authorization`
con valori letterali. Nessun risultato: il token viene sempre letto dallo storage.

## Piano vetrina

- **Dati**: nuova chiave `vetrina` in `chrome.storage.local`, separata da `carte`.
- **Logica pura** in `vetrina-core.js` (prezzo di mercato, prezzo mostrato, scostamento, URL,
  costruzione di `vetrina.json`), caricata da service worker (`importScripts`), pagina options e test Node.
- **Estrazione**: `estraiPrezzoMinimoItalia` spostata *senza modifiche di logica* in `estrai.js` (per
  poterla testare su fixture e riusarla nel content script); restituisce in più l'array `prezzi`.
- **Pulsante "Metti in vetrina"**: content script sul Ledger (`loops9.github.io/tracker/`), nella
  scheda di dettaglio di ogni carta. *(Prima versione: sulle pagine Cardmarket; spostato su richiesta.)*
- **Gestione**: `options.html/js`, con aggiornamento prezzi che riusa `controllaCarta` (poi reso parallelo, vedi "Scraping veloce").
- **Pubblicazione**: `github.js`, stessa Contents API ma con errori espliciti (token mancante o non
  valido, permessi, conflitto di sha con un nuovo tentativo). Le immagini vengono scaricate, ridotte a
  480px e committate in `vetrina/img/<id>.jpg`.
- **Pagina**: `vetrina/index.html` + `vetrina.css` + `vetrina.js`, legge `vetrina/vetrina.json`.
  `index.html` e `data.json` non vengono toccati. `sw.js` viene escluso dalla cartella `/vetrina/` per
  non servire una vetrina vecchia dalla cache.

## Stato (9/11/2026): implementato

| File | Cosa |
|---|---|
| `vetrina-core.js` | funzioni pure: `calcolaMarketPrice`, `prezzoMostrato`, `scostamentoPct`, `applicaMercato` (non tocca mai `customPrice`), `costruisciVetrinaJson`… |
| `estrai.js` | `estraiPrezzoMinimoItalia` spostata da `background.js`; in più restituisce `prezzi` e riconosce il blocco Cloudflare 403 (vedi sotto). |
| `github.js` | Contents API con errori leggibili e un nuovo tentativo sul conflitto di sha. |
| `ledger-content.js` | pulsante "Metti in vetrina" nella scheda di dettaglio del Ledger + modulo (shadow DOM); dati dalla lista `carte` del tracker. |
| `options.html/css/js` | gestione: quantità, prezzo personale, venduta, rimozione, scostamento >20%, Aggiorna prezzi, Pubblica. |
| `background.js` | scraping veloce (vedi sotto), `aggiornaVetrina`, `pubblicaVetrina`; `scaricaMiniatura` accetta la larghezza; regola Referer reinstallata anche all'avvio del browser. |
| `vetrina/` | pagina pubblica: `index.html`, `vetrina.css`, `vetrina.js`; l'estensione ci scrive `vetrina.json` e `img/`. |
| `sw.js` | ignora `/vetrina/` (prima avrebbe servito la vetrina dalla cache). |

Struttura dati in `chrome.storage.local.vetrina[]`: `id, url, nome, codice, espansione, rarita,
condizione, lingua, quantita, immagineUrl, marketPrice, marketSampleSize, customPrice, sold,
updatedAt` + interni `marketStato, marketAggiornatoIl, immagineFile, immagineFileSorgente`.

`vetrina/vetrina.json` contiene solo i dati pubblici (nome, codice, espansione, rarità,
condizione, lingua, quantità, prezzo finale, immagine relativa, venduta): niente URL Cardmarket,
`marketPrice` o `customPrice`. Le carte senza alcun prezzo non vengono pubblicate e sono segnalate.

### Grafica e flusso di pubblicazione (9/11/2026, seconda revisione)
- Stile unico "carta e inchiostro" per Ledger, vetrina, gestione e modulo: toni caldi, titoli e
  cifre grandi con grazie (Iowan/Palatino/Georgia), testo senza grazie, accento terracotta; chiaro
  o scuro secondo il sistema. Nel Ledger sono stati cambiati solo i valori delle variabili CSS
  (i nomi storici `--inchiostro`, `--oro`… restano) e i colori dei grafici passano per `style`.
- Segnalazione dell'utente: "aggiungo una carta ma la vetrina resta vuota". L'aggiunta funzionava, ma
  la pubblicazione era un passo separato e non evidente. Ora il modulo ha **Aggiungi e pubblica**
  (con conferma, avvisi ed errori nel modulo stesso) e **Solo aggiungi**; la gestione mostra
  "modifiche non ancora pubblicate" (`vetrinaModificataIl` > `vetrinaPubblicataIl`).

### Scraping veloce (tracker e vetrina)
La versione su GitHub fino al 9/11/2026 era quella lenta: una scheda **in primo piano** alla volta,
attesa di `status: complete` (immagini e pubblicità comprese) + 5 s, pausa di 4–9 s tra le carte.
Una versione più veloce esisteva solo sul PC ed è andata persa sovrascrivendo la cartella; è stata
rifatta così:
- `SCHEDE_PARALLELE = 4` schede insieme (`inParallelo`), sfasate di 0,3–1,2 s;
- schede aperte con `active: false`: non prendono il focus e non cambiano la scheda corrente;
- `leggiQuandoPronta`: ogni 250 ms chiede alla scheda `statoPaginaCardmarket()`; appena l'HTML è
  arrivato (`readyState` diverso da `loading`) e non c'è una sfida Cloudflare, estrae. Timeout 45 s;
- vale sia per "Controlla ora" (`controllaTutte`) sia per "Aggiorna prezzi" della vetrina.

Provata anche una finestra separata ridotta a icona: con Chrome su Linux (Xvfb + openbox) la finestra
viene ripristinata quando ci si apre una scheda, in modo non deterministico. Scartata: le schede in
background sono l'unica soluzione affidabile. Su Windows/Mac non verificabile da qui.

### Bug trovato e corretto nell'estrazione esistente
La pagina di blocco vero di Cloudflare ("Attention Required! | Cloudflare", 403) non veniva
riconosciuta: zero righe → "nessuna inserzione". Nel tracker la carta mostrava "—" invece di
"bloccato"; nella vetrina avrebbe azzerato un prezzo valido. Ora risultano `bloccato: true` sia quella
pagina sia qualunque pagina senza la scheda prodotto. La fixture `test/fixtures/cloudflare-403.html`
è la risposta reale ricevuta dalla VPS, con IP e Ray ID oscurati.

### Test
- `npm test`: test unitari Node (calcolo, arrotondamento, JSON, link PayPal, ordinamento/ricerca, GitHub con fetch finto) + il vecchio `filtro.test.js`.
- `npm install && npx playwright install chromium && npm run test:e2e`: estrazione su fixture in
  Chromium; estensione vera caricata (pulsante, options, scraping in parallelo e in background, blocco
  Cloudflare, pubblicazione contro una GitHub API simulata, immagine reale dal CDN ridotta a 480px);
  pagina vetrina a 390/1280px, chiaro/scuro, stati vuoto/mancante/rotto; Ledger ancora funzionante.
  Screenshot in `test/output/` (ignorata da git).

### Limiti noti / da verificare dal vivo
- Le fixture delle pagine prodotto sono **ricostruite** sui selettori già in uso (validati).
- Le schede in background non risolvono le sfide Cloudflare peggio di quelle in primo piano? Non
  verificabile dalla VPS: se molte carte risultano "bloccate", abbassare `SCHEDE_PARALLELE`.
- Rarità non ricavabile dal tracker: va scritta a mano nel modulo (facoltativa).
- Il prezzo di mercato non filtra per condizione/lingua della carta (come da specifica), ma usa il
  filtro del tracker se c'è (es. "PSA 10"): la vetrina eredita `filtroInfo` dalla carta tracciata.
- `sincronizzaGitHub` (data.json) continua a ignorare gli errori: si potrebbe passarla a `github.js`.
- `filtro.js` resta non usato da `background.js`.
- Il token è in chiaro in `chrome.storage.local`: usare un fine-grained token limitato a questo repo
  con solo "Contents: Read and write".

### Manifest e permessi
Verificato (9/11/2026): `manifest.json` è JSON valido, tutti i file citati (service worker, file
caricati con `importScripts`, popup, options, icone, content script) esistono, e Chromium carica
l'estensione senza errori (test e2e). Nessun permesso nuovo in `permissions`/`host_permissions`;
l'unico accesso in più è il content script sul Ledger:

| Voce | Perché basta quello che c'era |
|---|---|
| `options_ui` | non è un permesso; registra la pagina di gestione. |
| `content_scripts` su `https://loops9.github.io/tracker/*` (escluso `/tracker/vetrina/*`) | **unico accesso nuovo**: serve a mostrare "Metti in vetrina" nel Ledger. Limitato alla cartella del Ledger; non è in `host_permissions` e il content script non fa richieste di rete, legge solo `chrome.storage.local`. |
| `storage` | lista `vetrina`, come `carte`. |
| `tabs` + `scripting` | aggiornamento prezzi della vetrina: riusa `controllaCarta`. |
| `declarativeNetRequest` | stessa regola Referer, per scaricare le immagini da pubblicare e mostrarle nelle options. |
| `https://api.github.com/*` | pubblicazione di `vetrina/vetrina.json` e `vetrina/img/`. |

Non toccati, ma riducibili in futuro: `alarms` serve solo a cancellare un vecchio allarme;
`tabs` probabilmente non è necessario (`tabs.create/remove` funzionano senza). Lasciati com'erano per non cambiare il comportamento esistente.
Solo la copia dell'estensione usata nei test e2e aggiunge `http://127.0.0.1/*` (server delle fixture).

## Immagini delle versioni alternative (V.2, V.3…)

Le pagine prodotto hanno caroselli con altre carte, comprese le altre versioni
dello stesso codice (sulla pagina della V.2 compaiono anche V.1 e V.3). Prima
l'immagine veniva scelta cercando il codice nell'`alt`, quindi poteva uscire la
versione sbagliata. Ora `estrai.js` sceglie l'immagine con l'`alt` identico al
nome nell'`h1` (es. "Monkey.D.Luffy (OP13-118) (V.2)", preferendo quella senza
classe `lazy`), poi `og:image`, e solo alla fine il codice. Verificato sulle
pagine reali V.1/V.2 salvate dall'utente; le fixture `prodotto-versione-*.html`
ne ricalcano la struttura senza dati personali.

Le immagini già salvate si correggono da sole: il tracker riscarica la
miniatura quando l'URL letto cambia, e `applicaMercato` ora sostituisce sempre
l'`immagineUrl` della vetrina con quella appena letta (se valida), quindi alla
ripubblicazione il file in `vetrina/img/` viene ricaricato.

### Backup e trasferimento su un altro PC (9/11/2026, v1.4)
- `backup.js`: formato `{ formato: "cardmarket-tracker-backup", versione: 1, esportatoIl, dati }` con
  `carte, storico, vetrina, vetrinaPubblicataIl, vetrinaModificataIl, ultimoControllo, githubOwner,
  githubRepo, githubPath`; il token solo se l'utente risponde OK alla domanda. `vetrinaProgresso` resta fuori.
- Importazione: sostituisce i dati del browser dopo una conferma con il riepilogo; accetta anche il
  vecchio file del popup (`{ carte, storico }`); se il file non ha il token, quello già presente resta.
- Pulsanti "Esporta dati" / "Importa dati" nel Ledger sotto il titolo (`ledger-backup.js`, solo con
  l'estensione) e nel popup ("Esporta tutti i dati", che prima esportava solo carte e storico).
- Test: `test/backup.test.js` e blocco "backup" in `test/e2e.js` (esporta, svuota lo storage, reimporta).
