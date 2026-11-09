# Cardmarket Tracker – One Piece

Estensione Chrome che controlla i prezzi delle carte One Piece TCG su Cardmarket dai venditori
italiani, più due pagine pubblicate su GitHub Pages:

- **Ledger** (privato di fatto, è il tuo storico): https://loops9.github.io/tracker/
- **Vetrina** (da mandare agli amici): https://loops9.github.io/tracker/vetrina/

## Aggiornare l'estensione dopo un `git pull`

L'estensione è caricata "non pacchettizzata" da questa cartella, quindi Chrome non si accorge da solo
dei file nuovi.

1. `git pull` nella cartella del repo.
2. Apri `chrome://extensions`.
3. Sulla scheda "Cardmarket Price Tracker - One Piece" premi **Ricarica** (la freccia circolare).
4. Ricarica anche le schede di Cardmarket già aperte, altrimenti non vedono il pulsante nuovo.

Se l'estensione non è ancora installata: `chrome://extensions` → attiva "Modalità sviluppatore" →
"Carica estensione non pacchettizzata" → scegli questa cartella.

## Usare la vetrina

1. **Impostazioni GitHub** (una volta sola): popup dell'estensione → "Impostazioni GitHub", oppure in
   fondo alla pagina di gestione. Utente `loops9`, repository `tracker`, e un token. Consigliato un
   *fine-grained token* limitato a questo repository con solo "Contents: Read and write".
2. **Aggiungere una carta**: apri la pagina della carta su Cardmarket e premi **Metti in vetrina** (in
   basso a destra). Nome, codice, espansione, rarità e immagine sono letti dalla pagina: controllali,
   scegli condizione, lingua e quantità e premi "Aggiungi".
3. **Gestire**: popup → **Gestisci vetrina** (oppure Opzioni dell'estensione). Qui puoi:
   - premere **Aggiorna prezzi**: apre una alla volta le pagine Cardmarket filtrate sui venditori
     italiani e calcola il prezzo di mercato (media dei 3 prezzi più bassi). Lascia lavorare la pagina;
   - scrivere un **prezzo personale** (vuoto = si usa il prezzo di mercato). Lo scostamento oltre il
     20% dal mercato è evidenziato. L'aggiornamento prezzi non lo modifica mai;
   - cambiare la quantità, segnare una carta come **venduta** o toglierla (✕).
4. **Pubblicare**: premi **Pubblica vetrina**. Vengono caricati su GitHub `vetrina/vetrina.json` e le
   immagini. Dopo circa un minuto la pagina è aggiornata.

Le carte vendute restano in fondo alla pagina con l'etichetta "Venduta". Le carte senza alcun prezzo
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
```

Architettura, decisioni e limiti noti: [NOTES.md](NOTES.md).
