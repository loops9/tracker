const test = require("node:test");
const assert = require("node:assert");
const { creaBackup, leggiBackup, riassuntoBackup, nomeFileBackup, BACKUP_FORMATO } = require("../backup.js");

const storage = {
  carte: [{ nome: "Luffy", link: "https://www.cardmarket.com/it/OnePiece/Products/Singles/x" }],
  storico: [{ nome: "Luffy", prezzo: 2 }],
  vetrina: [{ id: "a", nome: "Luffy", quantita: 2 }],
  vetrinaPubblicataIl: 1, vetrinaModificataIl: 2, ultimoControllo: 3,
  vetrinaProgresso: { fatte: 1, totale: 2, inCorso: true },
  githubOwner: "loops9", githubRepo: "tracker", githubToken: "segreto",
};

test("il backup contiene tutto tranne i dati di passaggio, token solo se richiesto", () => {
  const b = creaBackup(storage);
  assert.strictEqual(b.formato, BACKUP_FORMATO);
  assert.deepStrictEqual(b.dati.vetrina, storage.vetrina);
  assert.strictEqual(b.dati.githubRepo, "tracker");
  assert.ok(!("vetrinaProgresso" in b.dati));
  assert.ok(!("githubToken" in b.dati));
  assert.strictEqual(creaBackup(storage, { conToken: true }).dati.githubToken, "segreto");
});

test("andata e ritorno: leggiBackup restituisce le stesse chiavi", () => {
  const d = leggiBackup(JSON.stringify(creaBackup(storage, { conToken: true })));
  for (const k of ["carte", "storico", "vetrina", "vetrinaPubblicataIl", "githubOwner", "githubToken"]) assert.deepStrictEqual(d[k], storage[k]);
  assert.ok(!("vetrinaProgresso" in d));
});

test("accetta il vecchio file del popup (solo carte e storico)", () => {
  const d = leggiBackup(JSON.stringify({ carte: storage.carte }));
  assert.deepStrictEqual(d, { carte: storage.carte, storico: [] });
});

test("file non validi: errori leggibili", () => {
  assert.throws(() => leggiBackup("{x"), /JSON valido/);
  assert.throws(() => leggiBackup('{"a":1}'), /non è un backup/);
  assert.throws(() => leggiBackup(JSON.stringify({ formato: BACKUP_FORMATO, versione: 1, dati: { carte: [], vetrina: 5 } })), /vetrina/);
  assert.throws(() => leggiBackup(JSON.stringify({ formato: BACKUP_FORMATO, versione: 99, dati: { carte: [] } })), /più nuova/);
});

test("riepilogo e nome file", () => {
  assert.match(riassuntoBackup(leggiBackup(JSON.stringify(creaBackup(storage)))), /1 carte tracciate, 1 righe di storico, 1 carte in vetrina, impostazioni GitHub \(loops9\/tracker, senza token\)/);
  assert.strictEqual(nomeFileBackup(new Date(2026, 10, 9)), "cardmarket-tracker-backup-2026-11-09.json");
});
