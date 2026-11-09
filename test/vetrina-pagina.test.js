const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../vetrina/vetrina.js");

test("link paypal.me: punto decimale e due decimali", () => {
  assert.equal(v.linkPaypal(12.5), "https://paypal.me/tommasoloops/12.50EUR");
  assert.equal(v.linkPaypal(7), "https://paypal.me/tommasoloops/7.00EUR");
  assert.equal(v.linkPaypal(1234.56), "https://paypal.me/tommasoloops/1234.56EUR");
  assert.equal(v.linkPaypal(0.1 + 0.2), "https://paypal.me/tommasoloops/0.30EUR");
  assert.equal(v.linkPaypal(0), null);
  assert.equal(v.linkPaypal(null), null);
  assert.equal(v.linkPaypal(NaN), null);
});

const carte = [
  { nome: "Zoro", prezzo: 5, venduta: false, codice: "OP01-025" },
  { nome: "Luffy", prezzo: 20, venduta: true, codice: "OP01-024" },
  { nome: "Nami", prezzo: 2, venduta: false, codice: "OP01-016", espansione: "Romance Dawn" },
  { nome: "Ace", prezzo: 50, venduta: false, codice: "OP02-013", lingua: "Giapponese" },
];

test("ordinamento: le vendute restano in fondo", () => {
  assert.deepEqual(v.ordinaCarte(carte, "prezzo-asc").map((c) => c.nome), ["Nami", "Zoro", "Ace", "Luffy"]);
  assert.deepEqual(v.ordinaCarte(carte, "prezzo-desc").map((c) => c.nome), ["Ace", "Zoro", "Nami", "Luffy"]);
  assert.deepEqual(v.ordinaCarte(carte, "nome").map((c) => c.nome), ["Ace", "Nami", "Zoro", "Luffy"]);
});

test("ricerca: senza maiuscole/accenti, tutte le parole", () => {
  assert.deepEqual(v.filtraCarte(carte, "op01").map((c) => c.nome), ["Zoro", "Luffy", "Nami"]);
  assert.deepEqual(v.filtraCarte(carte, "romance NAMI").map((c) => c.nome), ["Nami"]);
  assert.deepEqual(v.filtraCarte(carte, "giappònese").map((c) => c.nome), ["Ace"]);
  assert.equal(v.filtraCarte(carte, "  ").length, 4);
});

test("dati non validi o vuoti", () => {
  assert.deepEqual(v.carteValide(null), []);
  assert.deepEqual(v.carteValide({}), []);
  assert.deepEqual(v.carteValide({ carte: [] }), []);
  assert.equal(v.carteValide({ carte: [{ nome: "A", prezzo: 1 }, { nome: "B", prezzo: "1" }, { prezzo: 3 }, null] }).length, 1);
});

test("immagini: solo file locali in img/", () => {
  assert.equal(v.percorsoImmagineSicuro("img/c1abc.jpg"), "img/c1abc.jpg");
  assert.equal(v.percorsoImmagineSicuro("https://evil.example/x.jpg"), null);
  assert.equal(v.percorsoImmagineSicuro("img/../../x.jpg"), null);
  assert.equal(v.percorsoImmagineSicuro("javascript:alert(1)"), null);
});
