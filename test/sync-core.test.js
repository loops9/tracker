const test = require("node:test");
const assert = require("node:assert/strict");
const { unisciStati, impronta, contenutoDataJson, conEliminazione } = require("../sync-core.js");

const ORA = 1800000000000;
const carta = (link, extra = {}) => ({ link, nome: link, quantita: 1, filtroInfo: null, ultimoPrezzo: null, ultimaData: null, ...extra });
const T = (n) => ORA - 1000000 + n; // istanti recenti
const vc = (id, extra = {}) => ({ id, nome: id, customPrice: null, sold: false, updatedAt: 1, ...extra });

test("primo giro: data.json vecchio senza vetrina, la vetrina locale resta", () => {
  const u = unisciStati({ carte: [carta("a")], vetrina: [vc("v1")] }, { carte: [carta("a"), carta("b")], storico: [] }, ORA);
  assert.deepEqual(u.carte.map((c) => c.link), ["a", "b"]);
  assert.deepEqual(u.vetrina.map((c) => c.id), ["v1"]);
});

test("niente data.json su GitHub: resta tutto il locale", () => {
  const u = unisciStati({ carte: [carta("a")], storico: [{ link: "a", data: 1, prezzo: 2 }] }, null, ORA);
  assert.equal(u.carte.length, 1);
  assert.equal(u.storico.length, 1);
});

test("carte: prezzo più recente da un PC, nome modificato dall'altro", () => {
  const pcA = carta("a", { nome: "vecchio", ultimoPrezzo: 10, ultimaData: 100 });
  const pcB = carta("a", { nome: "nuovo", modificatoIl: 50, ultimoPrezzo: 8, ultimaData: 40 });
  const u = unisciStati({ carte: [pcA] }, { carte: [pcB] }, ORA);
  assert.equal(u.carte[0].nome, "nuovo");
  assert.equal(u.carte[0].ultimoPrezzo, 10);
  assert.equal(u.carte[0].ultimaData, 100);
});

test("carte: l'immagine buona non si perde", () => {
  const u = unisciStati(
    { carte: [carta("a", { immagine: "data:x", ultimaData: 1 })] },
    { carte: [carta("a", { immagine: null, ultimaData: 2, ultimoPrezzo: 5 })] }, ORA);
  assert.equal(u.carte[0].immagine, "data:x");
  assert.equal(u.carte[0].ultimoPrezzo, 5);
});

test("carta eliminata su un PC sparisce anche dall'altro, anche dopo un controllo prezzi", () => {
  const eliminati = conEliminazione(null, "carte", "a", T(500));
  const u = unisciStati({ carte: [carta("b")], eliminati }, { carte: [carta("a", { ultimaData: T(900) }), carta("b")] }, ORA);
  assert.deepEqual(u.carte.map((c) => c.link), ["b"]);
  assert.equal(u.eliminati.carte.a, T(500));
});

test("carta riaggiunta dopo l'eliminazione torna", () => {
  const eliminati = conEliminazione(null, "carte", "a", T(500));
  const u = unisciStati({ carte: [carta("a", { modificatoIl: T(600) })], eliminati }, { carte: [] }, ORA);
  assert.deepEqual(u.carte.map((c) => c.link), ["a"]);
});

test("vetrina: vince la modifica più recente, per carta", () => {
  const u = unisciStati(
    { vetrina: [vc("v1", { customPrice: 10, updatedAt: 200 }), vc("v2", { sold: false, updatedAt: 100 })] },
    { vetrina: [vc("v1", { customPrice: 9, updatedAt: 150 }), vc("v2", { sold: true, updatedAt: 300 }), vc("v3")] }, ORA);
  assert.deepEqual(u.vetrina.map((c) => [c.id, c.customPrice, c.sold]), [["v1", 10, false], ["v2", null, true], ["v3", null, false]]);
});

test("vetrina: carta tolta su un PC non torna dall'altro", () => {
  const eliminati = conEliminazione(null, "vetrina", "v1", T(500));
  const u = unisciStati({ vetrina: [], eliminati }, { vetrina: [vc("v1", { updatedAt: T(400) })] }, ORA);
  assert.equal(u.vetrina.length, 0);
});

test("eliminazioni ricevute dall'altro PC vengono applicate e conservate", () => {
  const remoto = { vetrina: [], eliminati: { carte: {}, vetrina: { v1: T(500) } } };
  const u = unisciStati({ vetrina: [vc("v1", { updatedAt: T(400) })] }, remoto, ORA);
  assert.equal(u.vetrina.length, 0);
  assert.equal(u.eliminati.vetrina.v1, T(500));
});

test("eliminazioni molto vecchie vengono dimenticate", () => {
  const vecchia = ORA - 200 * 86400000;
  const u = unisciStati({ eliminati: { carte: { a: vecchia }, vetrina: {} } }, null, ORA);
  assert.deepEqual(u.eliminati.carte, {});
});

test("storico: unione senza doppioni, in ordine di data", () => {
  const r = (link, data) => ({ link, data, prezzo: 1 });
  const u = unisciStati({ storico: [r("a", 1), r("a", 3)] }, { storico: [r("a", 3), r("b", 2)] }, ORA);
  assert.deepEqual(u.storico.map((x) => x.link + x.data), ["a1", "b2", "a3"]);
});

test("unire due volte non cambia niente (nessun commit inutile)", () => {
  const locale = { carte: [carta("a", { ultimaData: 5 })], storico: [{ link: "a", data: 5 }], vetrina: [vc("v1")] };
  const remoto = { carte: [carta("b")], storico: [{ link: "b", data: 2 }], vetrina: [vc("v2")] };
  const u1 = unisciStati(locale, remoto, ORA);
  const u2 = unisciStati(u1, contenutoDataJson(u1, ORA), ORA);
  assert.equal(impronta(u2), impronta(u1));
  assert.equal(impronta(contenutoDataJson(u1, ORA + 1)), impronta(u1)); // aggiornatoIl non conta
});

test("data.json resta leggibile da Ledger e cmtrack", () => {
  const d = contenutoDataJson(unisciStati({ carte: [carta("a")] }, null, ORA), ORA);
  assert.ok(Array.isArray(d.carte) && Array.isArray(d.storico));
  assert.equal(d.aggiornatoIl, ORA);
});
