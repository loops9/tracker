const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../vetrina-core.js");

test("marketPrice: media dei 3 prezzi più bassi", () => {
  assert.deepEqual(core.calcolaMarketPrice([3.5, 2, 2.4, 9.99, 2.1]), { marketPrice: 2.17, marketSampleSize: 3 });
});

test("marketPrice: meno di 3 inserzioni -> media delle disponibili", () => {
  assert.deepEqual(core.calcolaMarketPrice([4, 5.25]), { marketPrice: 4.63, marketSampleSize: 2 });
  assert.deepEqual(core.calcolaMarketPrice([7.3]), { marketPrice: 7.3, marketSampleSize: 1 });
});

test("marketPrice: zero inserzioni -> null", () => {
  assert.deepEqual(core.calcolaMarketPrice([]), { marketPrice: null, marketSampleSize: 0 });
  assert.deepEqual(core.calcolaMarketPrice(undefined), { marketPrice: null, marketSampleSize: 0 });
});

test("marketPrice: arrotondamento al centesimo senza errori di virgola mobile", () => {
  // media 1,005: in virgola mobile (1 + 1.01) / 2 * 100 = 100.4999… e
  // l'arrotondamento ingenuo darebbe 1,00; in centesimi interi è 1,01
  assert.equal(Math.round(((1 + 1.01) / 2) * 100) / 100, 1);
  assert.equal(core.calcolaMarketPrice([1.0, 1.01]).marketPrice, 1.01);
  assert.equal(core.calcolaMarketPrice([0.1, 0.2, 0.3]).marketPrice, 0.2);
  assert.equal(core.calcolaMarketPrice([1, 1, 2]).marketPrice, 1.33);
  assert.equal(core.calcolaMarketPrice([1, 2, 2]).marketPrice, 1.67);
});

test("marketPrice: ignora valori non validi", () => {
  assert.deepEqual(core.calcolaMarketPrice([NaN, null, "3", 5]), { marketPrice: 5, marketSampleSize: 1 });
});

test("parsePrezzoEuro: formato europeo", () => {
  assert.equal(core.parsePrezzoEuro("6.199,00 €"), 6199);
  assert.equal(core.parsePrezzoEuro("0,89 €"), 0.89);
  assert.equal(core.parsePrezzoEuro("1.234.567,5 €"), 1234567.5);
  assert.equal(core.parsePrezzoEuro("—"), null);
});

test("prezzo mostrato: customPrice vince, altrimenti marketPrice", () => {
  assert.equal(core.prezzoMostrato({ customPrice: 15, marketPrice: 10 }), 15);
  assert.equal(core.prezzoMostrato({ customPrice: null, marketPrice: 10 }), 10);
  assert.equal(core.prezzoMostrato({ customPrice: null, marketPrice: null }), null);
  assert.equal(core.prezzoMostrato({ customPrice: 0.5, marketPrice: null }), 0.5);
});

test("scostamento: evidenziato solo sopra il 20%", () => {
  assert.equal(core.scostamentoPct({ customPrice: 12, marketPrice: 10 }), 20);
  assert.equal(core.scostamentoAlto({ customPrice: 12, marketPrice: 10 }), false);
  assert.equal(core.scostamentoAlto({ customPrice: 12.01, marketPrice: 10 }), true);
  assert.equal(core.scostamentoAlto({ customPrice: 7.9, marketPrice: 10 }), true);
  assert.equal(core.scostamentoPct({ customPrice: null, marketPrice: 10 }), null);
  assert.equal(core.scostamentoPct({ customPrice: 5, marketPrice: null }), null);
});

test("leggiPrezzoInput: virgola, punto, vuoto, non validi", () => {
  assert.equal(core.leggiPrezzoInput("12,5"), 12.5);
  assert.equal(core.leggiPrezzoInput("12.50"), 12.5);
  assert.equal(core.leggiPrezzoInput(" 7 € "), 7);
  assert.equal(core.leggiPrezzoInput("1.234,50"), 1234.5);
  assert.equal(core.leggiPrezzoInput(""), null);
  assert.ok(Number.isNaN(core.leggiPrezzoInput("abc")));
  assert.ok(Number.isNaN(core.leggiPrezzoInput("-5")));
  assert.ok(Number.isNaN(core.leggiPrezzoInput("0")));
});

test("URL prodotto: interfaccia italiana, senza query", () => {
  assert.equal(
    core.normalizzaUrlProdotto("https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-024?sellerCountry=17&language=1#x"),
    "https://www.cardmarket.com/it/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-024"
  );
});

test("nuova carta: campi richiesti e valori di default", () => {
  const c = core.nuovaCartaVetrina({ url: "https://www.cardmarket.com/it/OnePiece/Products/Singles/X/Y", nome: " Luffy ", quantita: "0" }, 1000);
  for (const k of ["id", "url", "nome", "codice", "espansione", "rarita", "condizione", "lingua", "quantita",
    "immagineUrl", "marketPrice", "marketSampleSize", "customPrice", "sold", "updatedAt"]) {
    assert.ok(k in c, "manca " + k);
  }
  assert.equal(c.nome, "Luffy");
  assert.equal(c.quantita, 1);
  assert.equal(c.customPrice, null);
  assert.equal(c.sold, false);
  assert.match(c.id, /^[a-z0-9]+$/);
});

test("applicaMercato: non tocca mai customPrice", () => {
  const base = { id: "a", customPrice: 42, marketPrice: 10, marketSampleSize: 3 };
  const ok = core.applicaMercato(base, { prezzi: [1, 2, 3] }, 5);
  assert.equal(ok.customPrice, 42);
  assert.equal(ok.marketPrice, 2);
  assert.equal(ok.marketStato, "ok");
  assert.equal(ok.updatedAt, 5);
});

test("applicaMercato: zero inserzioni -> null e segnalazione", () => {
  const r = core.applicaMercato({ id: "a", customPrice: null, marketPrice: 10 }, { prezzi: [] }, 5);
  assert.equal(r.marketPrice, null);
  assert.equal(r.marketSampleSize, 0);
  assert.equal(r.marketStato, "nessuna inserzione italiana");
});

test("applicaMercato: pagina bloccata o errore -> il prezzo precedente resta", () => {
  const base = { id: "a", customPrice: null, marketPrice: 10, marketSampleSize: 3, marketAggiornatoIl: 1 };
  const b = core.applicaMercato(base, { bloccato: true, prezzi: [] }, 5);
  assert.equal(b.marketPrice, 10);
  assert.equal(b.marketAggiornatoIl, 1);
  assert.equal(b.marketStato, "bloccato (anti-bot)");
  const e = core.applicaMercato(base, { errore: "timeout" }, 5);
  assert.equal(e.marketPrice, 10);
  assert.match(e.marketStato, /timeout/);
});

test("vetrina.json: campi pubblici, prezzo mostrato, carte senza prezzo escluse", () => {
  const carte = [
    { id: "a", nome: "Luffy", codice: "OP01-024", espansione: "Romance Dawn", rarita: "SR", condizione: "NM", lingua: "Inglese",
      quantita: 2, marketPrice: 10, customPrice: 12.5, sold: false, url: "https://x", immagineUrl: "https://cdn/x.jpg" },
    { id: "b", nome: "Zoro", marketPrice: 3.2, customPrice: null, sold: true, quantita: 1 },
    { id: "c", nome: "Nami", marketPrice: null, customPrice: null, sold: false, quantita: 1 },
  ];
  const { dati, senzaPrezzo } = core.costruisciVetrinaJson(carte, { a: true }, Date.UTC(2026, 10, 9, 10, 0));
  assert.equal(dati.versione, 1);
  assert.equal(dati.aggiornatoIl, "2026-11-09T10:00:00.000Z");
  assert.equal(dati.carte.length, 2);
  assert.deepEqual(dati.carte[0], {
    id: "a", nome: "Luffy", codice: "OP01-024", espansione: "Romance Dawn", rarita: "SR", condizione: "NM",
    lingua: "Inglese", quantita: 2, prezzo: 12.5, immagine: "img/a.jpg", venduta: false,
  });
  assert.equal(dati.carte[1].prezzo, 3.2);
  assert.equal(dati.carte[1].immagine, null);
  assert.equal(dati.carte[1].venduta, true);
  assert.deepEqual(senzaPrezzo.map((c) => c.id), ["c"]);
  // niente dati interni nel file pubblico
  const json = JSON.stringify(dati);
  for (const k of ["marketPrice", "customPrice", "url", "immagineUrl"]) assert.ok(!json.includes(`"${k}"`), k);
});

test("base64Utf8: accenti", () => {
  assert.equal(Buffer.from(core.base64Utf8("Rarità €"), "base64").toString("utf8"), "Rarità €");
});

test("carta del tracker -> dati vetrina: codice ed espansione dall'URL", () => {
  const d = core.datiDaCartaTracciata({
    link: "https://www.cardmarket.com/it/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-024",
    nome: "luffy op01", immagineUrl: "https://cdn/x.jpg", filtroInfo: "PSA 10",
  });
  assert.deepEqual(d, {
    url: "https://www.cardmarket.com/it/OnePiece/Products/Singles/Romance-Dawn/Monkey-D-Luffy-OP01-024",
    nome: "luffy op01", codice: "OP01-024", espansione: "Romance Dawn", rarita: "", lingua: "Inglese",
    immagineUrl: "https://cdn/x.jpg", filtroInfo: "PSA 10",
  });
  const promo = core.datiDaCartaTracciata({ link: "https://www.cardmarket.com/it/OnePiece/Products/Singles/Promos-Japanese/MonkeyDL", nome: "x" });
  assert.equal(promo.codice, "");
  assert.equal(promo.espansione, "Promos Japanese");
  assert.equal(promo.lingua, "Giapponese");
  const box = core.datiDaCartaTracciata({ link: "https://www.cardmarket.com/it/OnePiece/Products/Booster-Boxes/Memorial-Collection-Booster-Box", nome: "eb03 box" });
  assert.equal(box.espansione, "");
});

test("il logo di Cardmarket non vale come immagine della carta", () => {
  assert.equal(core.immagineCartaValida("https://static.cardmarket.com/img/logos/cardmarket.png"), null);
  assert.equal(core.immagineCartaValida("https://product-images.s3.cardmarket.com/1621/EB05/919534/919534.jpg"), "https://product-images.s3.cardmarket.com/1621/EB05/919534/919534.jpg");
  assert.equal(core.immagineCartaValida(null), null);
  const box = core.datiDaCartaTracciata({ link: "https://www.cardmarket.com/it/OnePiece/Products/Booster-Boxes/Romance-Dawn-Booster-Box", nome: "box", immagineUrl: "https://static.cardmarket.com/img/logos/cardmarket.png" });
  assert.equal(box.immagineUrl, null);
});

test("carta del tracker -> prezzo di mercato dall'ultima rilevazione", () => {
  assert.deepEqual(core.mercatoDaCartaTracciata({ ultimaMedia3: 113.33, ultimeOfferte: 42, ultimaData: 7 }),
    { marketPrice: 113.33, marketSampleSize: 3, marketStato: "ok", marketAggiornatoIl: 7 });
  assert.equal(core.mercatoDaCartaTracciata({ ultimaMedia3: 5, ultimeOfferte: 2 }).marketSampleSize, 2);
  assert.equal(core.mercatoDaCartaTracciata({ ultimaMedia3: null }), null);
  assert.equal(core.mercatoDaCartaTracciata({ ultimaMedia3: 5, ultimoBloccato: true }), null);
});

test("nuova carta: conserva il filtro del tracker", () => {
  const c = core.nuovaCartaVetrina({ url: "https://www.cardmarket.com/it/OnePiece/Products/Singles/X/Y", nome: "A", filtroInfo: "PSA 10" });
  assert.equal(c.filtroInfo, "PSA 10");
});
