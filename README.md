# Cardmarket Tracker – One Piece

Estensione Chrome che controlla i prezzi delle carte One Piece TCG su Cardmarket dai venditori
italiani, più due pagine pubblicate su GitHub Pages:

- **Ledger** (privato di fatto, è il tuo storico): https://loops9.github.io/tracker/
- **Vetrina** (da mandare agli amici): https://loops9.github.io/tracker/vetrina/

## Aggiornare l'estensione

L'estensione è caricata "non pacchettizzata" da una cartella, quindi Chrome non si accorge da solo
dei file nuovi. **Usa sempre la stessa cartella**: caricandone un'altra Chrome crea un'estensione
nuova e vuota (senza carte, storico e token). La cartella giusta è in `chrome://extensions` →
Dettagli → "Caricata da".

1. Scarica i file nuovi, in uno dei due modi:
   - **senza git**: scarica https://github.com/loops9/tracker/archive/refs/heads/main.zip, estrailo e
     copia il *contenuto* della cartella `tracker-main` dentro la cartella dell'estensione,
     sovrascrivendo;
   - **con git**: `git pull` nella cartella.
2. Apri `chrome://extensions` e sulla scheda "Cardmarket Price Tracker - One Piece" premi **Ricarica**.
3. Ricarica anche le schede del Ledger già aperte, altrimenti non vedono il pulsante nuovo.

Prima di aggiornare, per sicurezza: popup → **Esporta lista carte** (carte e storico; il token no).

Se l'estensione non è ancora installata: `chrome://extensions` → attiva "Modalità sviluppatore" →
"Carica estensione non pacchettizzata" → scegli questa cartella.

## Usare la vetrina

1. **Impostazioni GitHub** (una volta sola): popup dell'estensione → "Impostazioni GitHub", oppure in
   fondo alla pagina di gestione. Utente `loops9`, repository `tracker`, e un token. Consigliato un
   *fine-grained token* limitato a questo repository con solo "Contents: Read and write".
2. **Aggiungere una carta**: apri il Ledger (https://loops9.github.io/tracker/), clicca la carta e
   nella scheda di dettaglio premi **Metti in vetrina**. Nome, immagine e prezzo di mercato arrivano
   dal tracker, codice ed espansione dall'URL Cardmarket: controllali, scegli condizione, lingua e
   quantità e premi **Aggiungi e pubblica**: la carta entra in vetrina e la pagina pubblica viene
   aggiornata subito (visibile dopo circa un minuto). Con "Solo aggiungi" invece la carta resta in
   attesa finché non pubblichi dalla gestione. Il pulsante lo vedi solo tu (serve l'estensione).
3. **Gestire**: popup → **Gestisci vetrina** (oppure Opzioni dell'estensione). Qui puoi:
   - premere **Aggiorna prezzi**: apre in background, quattro alla volta, le pagine Cardmarket
     filtrate sui venditori italiani e calcola il prezzo di mercato (media dei 3 prezzi più bassi).
     Puoi continuare a lavorare; le schede compaiono e spariscono da sole nella barra;
   - scrivere un **prezzo personale** (vuoto = si usa il prezzo di mercato). Lo scostamento oltre il
     20% dal mercato è evidenziato. L'aggiornamento prezzi non lo modifica mai;
   - cambiare la quantità, segnare una carta come **venduta** o toglierla (✕).
4. **Pubblicare**: premi **Pubblica vetrina**. Vengono caricati su GitHub `vetrina/vetrina.json` e le
   immagini. Dopo circa un minuto la pagina è aggiornata.

La gestione segnala in rosso quando ci sono modifiche non ancora pubblicate. Le carte vendute restano in fondo alla pagina con l'etichetta "Venduta". Le carte senza alcun prezzo
non vengono pubblicate: la pagina di gestione te lo segnala.

## Il link da mandare agli amici

**https://loops9.github.io/tracker/vetrina/**

Lo trovi anche nella pagina di gestione ("Apri la vetrina pubblicata ↗"). Ogni carta ha il pulsante
"Acquista con PayPal" che apre `paypal.me/tommasoloops/<prezzo>EUR`; in cima alla pagina c'è
l'invito a scriverti dopo il pagamento indicando la carta.

## Test

```
npm test                                   # unitari, nessuna dipendenza
npm install && npx playwright install chromium
npm run test:e2e                           # estensione vera in Chromium, screenshot in test/output/
E2E_GRAFICO=1 xvfb-run npm run test:e2e    # idem con finestre vere invece di headless
```

Architettura, decisioni e limiti noti: [NOTES.md](NOTES.md).
