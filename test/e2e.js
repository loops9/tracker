// Test end-to-end con Playwright (npm install && npx playwright install chromium).
//
//  A. estrazione prezzi e dati carta sulle pagine di esempio in test/fixtures
//  B. estensione vera caricata in Chromium: pulsante "Metti in vetrina",
//     pagina options, "Aggiorna prezzi" (le pagine Cardmarket sono servite
//     dalle fixture), "Pubblica vetrina" contro una GitHub API simulata
//     dentro il service worker. Le immagini arrivano dal CDN vero.
//  C. pagina vetrina servita in locale: screenshot a 390px e 1280px, chiaro
//     e scuro, stati vuoto/mancante/rotto; la pagina esistente si carica.
//
// Gli screenshot finiscono in test/output/ (ignorata da git).

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const http = require("http");

const RADICE = path.resolve(__dirname, "..");
const FIXTURE = path.join(__dirname, "fixtures");
const OUT = path.join(__dirname, "output");
const CDN = "https://product-images.s3.cardmarket.com/1621/";

let ok = 0;
let ko = 0;
function verifica(condizione, descrizione, dettaglio) {
  if (condizione) {
    ok++;
    console.log("  OK  " + descrizione);
  } else {
    ko++;
    console.log("  KO  " + descrizione + (dettaglio !== undefined ? "  →  " + JSON.stringify(dettaglio) : ""));
  }
}

function serviStatico(dir) {
  const tipi = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end("<h1>404</h1>");
    }
    res.writeHead(200, { "Content-Type": tipi[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// Pagine Cardmarket finte: il codice nell'URL sceglie la fixture.
const FIXTURE_PER_CODICE = {
  "OP13-118-V1": "prodotto-versione-1.html",
  "OP13-118-V2": "prodotto-versione-2.html",
  "OP01-024": "prodotto-5-inserzioni.html",
  "OP01-016": "prodotto-2-inserzioni.html",
  "OP05-119": "prodotto-0-inserzioni.html",
  "OP09-001": "prodotto-virgola.html",
  "CF-0001": "cloudflare.html",
  "CF-0403": "cloudflare-403.html",
  "NR-0001": "non-riconosciuta.html",
};
const sostituzioni = {}; // codice -> fixture, per simulare un blocco a metà test
function fixturePer(pathname) {
  const codice = Object.keys(FIXTURE_PER_CODICE).find((c) => pathname.includes(c));
  return codice ? path.join(FIXTURE, sostituzioni[codice] || FIXTURE_PER_CODICE[codice]) : null;
}
function urlProdotto(codice, query) {
  return `https://www.cardmarket.com/it/OnePiece/Products/Singles/Test/Carta-${codice}${query || ""}`;
}
async function servFixture(route) {
  const file = fixturePer(new URL(route.request().url()).pathname);
  if (!file) return route.fulfill({ status: 404, body: "fixture mancante" });
  route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", path: file });
}

// Le schede aperte con chrome.tabs.create sfuggono a ctx.route: per lo
// scraping dell'estensione le pagine Cardmarket vengono rimandate (regola
// DNR di sessione) a questo server locale, che risponde con le fixture.
// Il ritardo simula la rete: senza, ogni pagina finirebbe prima che parta
// la successiva e il parallelismo non si vedrebbe.
function serviFixture(ritardoMs) {
  const server = http.createServer((req, res) => {
    const file = fixturePer(new URL(req.url, "http://x").pathname);
    setTimeout(() => {
      res.writeHead(file ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(file ? fs.readFileSync(file) : "fixture mancante");
    }, ritardoMs || 0);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// Larghezza di un JPEG letta dal segmento SOF.
function larghezzaJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    const marcatore = buf[i + 1];
    const lung = buf.readUInt16BE(i + 2);
    if (marcatore >= 0xc0 && marcatore <= 0xc3) return buf.readUInt16BE(i + 7);
    i += 2 + lung;
  }
  return null;
}

// -------------------------------------------------------------- A. fixture

async function testFixture(browser) {
  console.log("\nA. Estrazione dalle pagine prodotto di esempio");
  const page = await browser.newPage();
  await page.route("https://www.cardmarket.com/**", servFixture);
  await page.route("https://product-images.s3.cardmarket.com/**", (r) => r.abort());

  async function estrai(codice) {
    await page.goto(urlProdotto(codice, "?sellerCountry=17"));
    for (const f of ["estrai.js", "vetrina-core.js"]) {
      await page.addScriptTag({ path: path.join(RADICE, f) });
    }
    return page.evaluate(async () => {
      const r = await estraiPrezzoMinimoItalia(null);
      return { ...r, mercato: calcolaMarketPrice(r.prezzi), stato: statoPaginaCardmarket() };
    });
  }

  const cinque = await estrai("OP01-024");
  verifica(JSON.stringify(cinque.prezzi) === "[2,2.1,2.4,3.5,9.99]", "5 inserzioni italiane, la tedesca ignorata, aria-label/title/data-original-title", cinque.prezzi);
  verifica(cinque.mercato.marketPrice === 2.17 && cinque.mercato.marketSampleSize === 3, "3+ inserzioni → media dei 3 più bassi = 2,17", cinque.mercato);
  verifica(cinque.prezzo === 2 && cinque.media3 === 2.17, "campi esistenti prezzo/media3 invariati", [cinque.prezzo, cinque.media3]);
  verifica(cinque.immagineUrl === CDN + "OP13/857338/857338.jpg", "immagine scelta per codice nell'alt", cinque.immagineUrl);
  verifica(cinque.stato === "pronta", "pagina prodotto riconosciuta come pronta", cinque.stato);

  // Versioni alternative: stesso codice, il carosello mostra prima le altre versioni.
  const v1 = await estrai("OP13-118-V1");
  verifica(v1.immagineUrl === CDN + "OP13/857337/857337.jpg", "V.1: immagine della V.1, non di un'altra versione nel carosello", v1.immagineUrl);
  const v2 = await estrai("OP13-118-V2");
  verifica(v2.immagineUrl === CDN + "OP13/857338/857338.jpg", "V.2: immagine della V.2, non della V.1 che compare prima", v2.immagineUrl);

  const due = await estrai("OP01-016");
  verifica(due.mercato.marketPrice === 4.63 && due.mercato.marketSampleSize === 2, "meno di 3 inserzioni → media di 2 = 4,63", due.mercato);

  const zero = await estrai("OP05-119");
  verifica(zero.mercato.marketPrice === null && zero.mercato.marketSampleSize === 0 && !zero.bloccato, "zero inserzioni → null, non bloccato", zero);

  const virgola = await estrai("OP09-001");
  verifica(JSON.stringify(virgola.prezzi) === "[999.99,1000,1234.56,6199]", "prezzi con virgola decimale e punto delle migliaia", virgola.prezzi);
  verifica(virgola.mercato.marketPrice === 1078.18, "media 999,99 / 1.000,00 / 1.234,56 = 1.078,18", virgola.mercato);

  const cf = await estrai("CF-0001");
  verifica(cf.bloccato === true && cf.prezzi === undefined, "sfida Cloudflare (\"Just a moment\") → bloccato", cf);
  verifica(cf.stato === "sfida", "durante la sfida Cloudflare la pagina non è considerata pronta", cf.stato);
  const cf403 = await estrai("CF-0403");
  verifica(cf403.bloccato === true, "blocco Cloudflare 403 (pagina reale \"Attention Required!\") → bloccato, non \"zero inserzioni\"", cf403);
  const nr = await estrai("NR-0001");
  verifica(nr.bloccato === true, "pagina che non è una scheda prodotto → non conta come zero inserzioni", nr);
  await page.close();
}

// ------------------------------------------------------------ B. estensione

function copiaEstensione() {
  const dest = path.join(OUT, "estensione");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(RADICE, "manifest.json"), "utf8"));
  const file = new Set(["manifest.json", "popup.html", "popup.js", "options.html", "options.js", "options.css", manifest.background.service_worker,
    ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap((c) => c.js)]);
  // anche i file caricati con importScripts
  const bg = fs.readFileSync(path.join(RADICE, manifest.background.service_worker), "utf8");
  (bg.match(/importScripts\(([^)]*)\)/)[1].match(/"[^"]+"/g) || []).forEach((f) => file.add(f.slice(1, -1)));
  file.forEach((f) => fs.copyFileSync(path.join(RADICE, f), path.join(dest, f)));
  // solo nella copia di test: permesso sul server locale delle fixture
  manifest.host_permissions.push("http://127.0.0.1/*");
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dest;
}

// GitHub finto dentro il service worker: un repo in memoria.
function installaGitHubFinto() {
  const vero = self.fetch.bind(self);
  self.__repo = new Map();
  self.__log = [];
  self.__modo = { token: "ok", conflittiDaSimulare: 0 };
  const risposta = (status, corpo) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
  self.fetch = async (input, opz = {}) => {
    const url = new URL(String(input.url || input));
    if (url.hostname !== "api.github.com") return vero(input, opz);
    const metodo = opz.method || "GET";
    const corpo = opz.body ? JSON.parse(opz.body) : null;
    self.__log.push({ metodo, path: url.pathname, corpo });
    if (self.__modo.token === "401") return risposta(401, { message: "Bad credentials" });

    if (url.pathname === "/repos/loops9/tracker") return risposta(200, { permissions: { push: true } });
    const p = decodeURIComponent(url.pathname.replace("/repos/loops9/tracker/contents/", ""));
    if (metodo === "GET") {
      if (self.__repo.has(p)) return risposta(200, { sha: self.__repo.get(p).sha });
      const figli = [...self.__repo.keys()].filter((k) => k.startsWith(p + "/"));
      if (figli.length) return risposta(200, figli.map((k) => ({ type: "file", path: k, name: k.split("/").pop(), sha: self.__repo.get(k).sha })));
      return risposta(404, { message: "Not Found" });
    }
    if (metodo === "PUT") {
      const esiste = self.__repo.get(p);
      if (self.__modo.conflittiDaSimulare > 0) {
        self.__modo.conflittiDaSimulare--;
        if (esiste) esiste.sha = "cambiato-" + Math.random();
        return risposta(409, { message: "is at x but expected y" });
      }
      if (esiste && corpo.sha !== esiste.sha) return risposta(409, { message: "sha mismatch" });
      if (!esiste && corpo.sha) return risposta(422, { message: "sha not expected" });
      if (corpo.branch !== "main") return risposta(422, { message: "branch" });
      self.__repo.set(p, { sha: "s" + Math.random().toString(36).slice(2), content: corpo.content });
      return risposta(esiste ? 200 : 201, { content: { path: p } });
    }
    if (metodo === "DELETE") {
      self.__repo.delete(p);
      return risposta(200, {});
    }
    return risposta(400, {});
  };
}

async function testEstensione() {
  console.log("\nB. Estensione caricata in Chromium");
  const dir = copiaEstensione();
  const profilo = path.join(OUT, "profilo");
  fs.rmSync(profilo, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(profilo, {
    channel: "chromium",
    // E2E_GRAFICO=1 (con xvfb): Chrome con finestre vere invece di headless
    headless: !process.env.E2E_GRAFICO,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await ctx.route("https://www.cardmarket.com/**", servFixture);

  // il service worker può partire prima che l'evento sia ascoltato: lo cerco a intervalli
  let sw = null;
  for (let i = 0; i < 60 && !sw; i++) {
    sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 500 }).catch(() => null));
  }
  if (!sw) throw new Error("service worker dell'estensione non avviato");
  const idEst = new URL(sw.url()).host;
  await sw.evaluate(installaGitHubFinto);
  const vetrina = () => sw.evaluate(async () => (await chrome.storage.local.get("vetrina")).vetrina || []);

  // --- carte del tracker (lista "carte"), come le avrebbe il Ledger
  const miniatura = JSON.parse(fs.readFileSync(path.join(RADICE, "data.json"), "utf8")).carte.find((c) => c.immagine)?.immagine || null;
  const ieri = Date.now() - 86400000;
  const tracciata = (codice, nome, img, media3, offerte) => ({
    nome, link: urlProdotto(codice), filtroInfo: null, quantita: 3, immagine: miniatura, immagineUrl: CDN + img,
    ultimoPrezzo: media3 == null ? null : media3 - 0.17, ultimaMedia3: media3, ultimeOfferte: offerte,
    ultimaData: ieri, ultimoErrore: null, ultimoBloccato: false,
  });
  const carteTracker = [
    tracciata("OP01-024", "Luffy OP01-024", "OP13/857338/857338.jpg", 2.17, 5),
    tracciata("OP01-016", "Nami OP01-016", "EB02/823515/823515.jpg", null, 0),
    tracciata("OP05-119", "Luffy OP05-119", "OP15/879905/879905.jpg", null, 0),
  ];
  await sw.evaluate((carte) => chrome.storage.local.set({ carte, storico: [] }), carteTracker);

  // --- Ledger servito in locale all'indirizzo vero (il content script lo riconosce)
  await ctx.route("https://loops9.github.io/tracker/**", (route) => {
    const p = new URL(route.request().url()).pathname.replace("/tracker/", "") || "index.html";
    if (p === "data.json") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ carte: carteTracker, storico: [], aggiornatoIl: ieri }) });
    }
    const file = path.join(RADICE, p);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ path: file });
  });
  const page = await ctx.newPage();
  await page.goto("https://loops9.github.io/tracker/");
  async function aggiungi(codice, quantita, lingua) {
    await page.locator(`.tessera[data-link="${urlProdotto(codice)}"]`).click();
    const pulsante = page.locator("#scheda a.apri[data-vetrina]");
    await pulsante.waitFor({ timeout: 10000 });
    await pulsante.click();
    const form = page.locator("#cm-tracker-vetrina form");
    await form.waitFor();
    await form.locator("input[name=quantita]").fill(String(quantita));
    if (lingua) await form.locator("select[name=lingua]").selectOption(lingua);
    return form;
  }
  async function chiudiTutto() {
    await page.keyboard.press("Escape"); // chiude il modulo
    verifica(await page.locator("#velo").isVisible(), "Esc chiude il modulo ma lascia aperta la scheda del Ledger");
    await page.keyboard.press("Escape"); // chiude la scheda del Ledger
  }

  let form = await aggiungi("OP01-024", 2, "Inglese");
  verifica(await form.locator("input[name=nome]").inputValue() === "Luffy OP01-024", "Ledger: modulo precompilato con il nome del tracker");
  verifica(await form.locator("input[name=codice]").inputValue() === "OP01-024", "Ledger: codice ricavato dall'URL");
  verifica(/2,17 €/.test(await form.locator(".nota").textContent()), "Ledger: prezzo di mercato dall'ultimo controllo del tracker");
  await page.screenshot({ path: path.join(OUT, "ledger-modulo.png") });
  await form.locator("button[value=solo]").click();
  await form.locator("[data-esito]").filter({ hasText: "Aggiunta" }).waitFor();
  await chiudiTutto();

  form = await aggiungi("OP01-024", 1, "Inglese");
  await form.locator("button[value=solo]").click();
  await form.locator("[data-esito]").filter({ hasText: "già in vetrina" }).waitFor();
  await chiudiTutto();

  form = await aggiungi("OP01-016", 1, "Giapponese");
  verifica(/Aggiorna prezzi/.test(await form.locator(".nota").textContent()), "Ledger: senza prezzo recente lo dice");
  await form.locator("button[value=solo]").click();
  await form.locator("[data-esito]").filter({ hasText: "Aggiunta" }).waitFor();
  await chiudiTutto();
  form = await aggiungi("OP05-119", 1);
  await form.locator("button[value=solo]").click();
  await form.locator("[data-esito]").filter({ hasText: "Aggiunta" }).waitFor();
  await chiudiTutto();

  let v = await vetrina();
  verifica(v.length === 3 && v[0].quantita === 3, "doppione (stesso URL, condizione, lingua) → quantità sommata", v.map((c) => c.quantita));
  verifica(v[0].marketPrice === 2.17 && v[0].marketSampleSize === 3 && v[1].marketPrice === null, "prezzo di mercato ripreso dal tracker", v.map((c) => c.marketPrice));
  verifica(v[1].lingua === "Giapponese" && v[1].condizione === "NM", "condizione e lingua scelte nel modulo", v[1]);
  verifica(v.every((c) => c.immagineUrl && c.immagineUrl.startsWith(CDN)), "URL immagine del CDN ripreso dal tracker", v.map((c) => c.immagineUrl));

  // il pulsante non compare sulle pagine di Cardmarket
  const cm = await ctx.newPage();
  await cm.goto(urlProdotto("OP01-024"));
  await cm.waitForTimeout(1000);
  verifica(await cm.locator("#cm-tracker-vetrina").count() === 0, "nessun pulsante sulle pagine Cardmarket");
  await cm.close();

  // --- pagina options
  const opt = await ctx.newPage();
  opt.on("dialog", (d) => d.accept());
  await opt.goto(`chrome-extension://${idEst}/options.html`);
  await opt.locator("#righe tr[data-id]").first().waitFor();
  verifica(await opt.locator("#righe tr[data-id]").count() === 3, "options: 3 righe");
  verifica(await opt.isVisible("#daPubblicare"), "options: avviso di modifiche non ancora pubblicate");

  const riga = (id) => opt.locator(`#righe tr[data-id="${id}"]`);
  await riga(v[0].id).locator("input.prezzo").fill("3,00");
  await riga(v[0].id).locator("input.prezzo").press("Enter");
  await riga(v[0].id).locator("input.prezzo").blur();
  await opt.waitForFunction((id) => document.querySelector(`tr[data-id="${id}"] .scost.alto`), v[0].id);
  verifica((await riga(v[0].id).locator(".scost").textContent()) === "+38%", "scostamento 3,00 vs 2,17 evidenziato (+38%)");
  await riga(v[1].id).locator("input.prezzo").fill("abc");
  await riga(v[1].id).locator("input.prezzo").blur();
  verifica(/Prezzo non valido/.test(await opt.locator("#stato").textContent()), "prezzo personale non valido segnalato");
  await riga(v[1].id).locator("input.prezzo").fill("");
  await riga(v[1].id).locator("input.prezzo").blur();

  // --- aggiorna prezzi: schede in parallelo, in background
  const fixtureServer = await serviFixture(1500);
  await sw.evaluate(() => {
    const nuovo = () => ({ aperte: new Set(), max: 0, attive: 0, totali: 0, cambiScheda: 0 });
    self.__schede = nuovo();
    self.__nuovoConteggio = nuovo;
    chrome.tabs.onCreated.addListener((t) => {
      if (!/cardmarket\.com/.test(t.pendingUrl || t.url || "")) return;
      const s = self.__schede;
      s.aperte.add(t.id); s.totali++; s.max = Math.max(s.max, s.aperte.size);
      if (t.active) s.attive++;
    });
    chrome.tabs.onRemoved.addListener((id) => self.__schede.aperte.delete(id));
    // la scheda in primo piano non deve mai cambiare durante lo scraping
    chrome.tabs.onActivated.addListener(() => self.__schede.cambiScheda++);
  });
  const leggiSchede = () => sw.evaluate(() => {
    const s = self.__schede;
    self.__schede = self.__nuovoConteggio();
    return { max: s.max, attive: s.attive, totali: s.totali, cambiScheda: s.cambiScheda };
  });
  await sw.evaluate((base) => chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [9001],
    addRules: [{
      id: 9001, priority: 2,
      action: { type: "redirect", redirect: { regexSubstitution: base + "\\1" } },
      condition: { regexFilter: "^https://www\\.cardmarket\\.com(/.*)$", resourceTypes: ["main_frame"] },
    }],
  }), fixtureServer.base);
  const inizio = Date.now();
  await opt.click("#btnAggiorna");
  await opt.locator("#stato").filter({ hasText: /^Prezzi:/ }).waitFor({ timeout: 180000 });
  const durata = (Date.now() - inizio) / 1000;
  console.log(`      (aggiornamento: ${durata.toFixed(0)} s) ${await opt.locator("#stato").textContent()}`);
  v = await vetrina();
  verifica(v[0].marketPrice === 2.17 && v[0].customPrice === 3, "aggiornamento: mercato 2,17, prezzo personale non toccato", v[0]);
  verifica(v[1].marketPrice === 4.63 && v[1].marketSampleSize === 2, "aggiornamento: 2 inserzioni → 4,63 con marketSampleSize 2", v[1]);
  verifica(v[2].marketPrice === null && v[2].marketStato === "nessuna inserzione italiana", "aggiornamento: zero inserzioni segnalato", v[2]);
  let schede = await leggiSchede();
  verifica(schede.max >= 2 && schede.totali === 3, "vetrina: più schede aperte contemporaneamente", schede);
  verifica(schede.attive === 0 && schede.cambiScheda === 0, "vetrina: schede in background, la scheda in primo piano non cambia", schede);
  verifica(durata < 10, "vetrina: 3 pagine da 1,5 s lette in parallelo in meno di 10 s (prima erano ~30 s)", durata);

  // --- tracker: "Controlla ora" usa lo stesso scraping veloce
  const inizioTracker = Date.now();
  await sw.evaluate(() => controllaTutte());
  const durataTracker = (Date.now() - inizioTracker) / 1000;
  const carteDopo = await sw.evaluate(async () => (await chrome.storage.local.get("carte")).carte);
  schede = await leggiSchede();
  console.log(`      (controllo tracker: ${durataTracker.toFixed(1)} s)`);
  verifica(carteDopo[0].ultimaMedia3 === 2.17 && carteDopo[0].ultimoPrezzo === 2 && carteDopo[1].ultimaMedia3 === 4.63 && carteDopo[2].ultimoPrezzo === null,
    "tracker: prezzi letti correttamente", carteDopo.map((c) => [c.ultimoPrezzo, c.ultimaMedia3]));
  verifica(schede.max >= 2 && schede.attive === 0 && schede.cambiScheda === 0 && durataTracker < 10, "tracker: in parallelo, in background, veloce", { ...schede, durataTracker });

  // Cloudflare blocca: il prezzo di mercato già noto resta
  sostituzioni["OP01-024"] = "cloudflare-403.html";
  await riga(v[0].id).locator("button[data-azione=aggiorna]").click();
  await opt.locator("#stato").filter({ hasText: /^Prezzi:/ }).waitFor({ timeout: 60000 });
  verifica(/1 bloccate da Cloudflare/.test(await opt.locator("#stato").textContent()), "options: blocco Cloudflare segnalato", await opt.locator("#stato").textContent());
  const dopoBlocco = (await vetrina())[0];
  verifica(dopoBlocco.marketPrice === 2.17 && dopoBlocco.marketStato === "bloccato (anti-bot)", "pagina bloccata → prezzo precedente conservato", dopoBlocco);
  delete sostituzioni["OP01-024"];
  fixtureServer.server.close();
  await sw.evaluate(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [9001] }));

  // venduta
  await riga(v[1].id).locator("input[type=checkbox]").check();
  await opt.waitForFunction((id) => document.querySelector(`tr[data-id="${id}"]`)?.classList.contains("venduta"), v[1].id);
  await opt.screenshot({ path: path.join(OUT, "options.png"), fullPage: true });

  // --- pubblica: errori
  await opt.click("#btnPubblica");
  await opt.locator("#stato").filter({ hasText: "non riuscita" }).waitFor();
  verifica(/Token GitHub mancante/.test(await opt.locator("#stato").textContent()), "pubblica senza token → messaggio chiaro");

  await opt.locator("#impostazioni").evaluate((d) => (d.open = true));
  await opt.fill("#inputGithubOwner", "loops9");
  await opt.fill("#inputGithubRepo", "tracker");
  await opt.fill("#inputGithubToken", "token-di-prova");
  await opt.click("#btnSalvaImpostazioni");
  await sw.evaluate(() => (self.__modo.token = "401"));
  await opt.click("#btnPubblica");
  await opt.locator("#stato").filter({ hasText: "non riuscita" }).waitFor();
  verifica(/non valido o scaduto/.test(await opt.locator("#stato").textContent()), "token non valido → messaggio chiaro");

  // --- pubblica: ok, con un conflitto di sha da superare
  await sw.evaluate(() => { self.__modo.token = "ok"; self.__modo.conflittiDaSimulare = 1; });
  await opt.click("#btnPubblica");
  await opt.locator("#stato").filter({ hasText: "Vetrina pubblicata" }).waitFor({ timeout: 60000 });
  const statoPubbl = await opt.locator("#stato").textContent();
  console.log("      " + statoPubbl.replace(/\n/g, "\n      "));
  verifica(/2 carte/.test(statoPubbl) && /nessun prezzo, non pubblicata/.test(statoPubbl), "pubblicate 2 carte, quella senza prezzo segnalata");

  const repo = await sw.evaluate(() => Object.fromEntries([...self.__repo].map(([k, x]) => [k, x.content])));
  const json = JSON.parse(Buffer.from(repo["vetrina/vetrina.json"], "base64").toString("utf8"));
  verifica(json.carte.length === 2 && json.carte[0].prezzo === 3 && json.carte[1].prezzo === 4.63 && json.carte[1].venduta, "vetrina.json: prezzo personale / di mercato, venduta", json.carte);
  verifica(!Object.keys(repo).includes("data.json"), "la pubblicazione della vetrina non scrive data.json", Object.keys(repo));
  const immagini = Object.keys(repo).filter((k) => k.startsWith("vetrina/img/"));
  verifica(immagini.length === 3, "immagini committate nel repo (anche quella della carta senza prezzo)", immagini);
  const jpeg = Buffer.from(repo[`vetrina/img/${v[0].id}.jpg`], "base64");
  verifica(larghezzaJpeg(jpeg) === 480, "immagine dal CDN reale scaricata (Referer riscritto) e ridotta a 480px", { byte: jpeg.length, larghezza: larghezzaJpeg(jpeg) });
  verifica(json.carte[0].immagine === `img/${v[0].id}.jpg`, "vetrina.json usa un percorso relativo all'immagine", json.carte[0].immagine);

  // --- ripubblica dopo aver tolto una carta: immagine eliminata, le altre non ricaricate
  await riga(v[2].id).locator("button[data-azione=rimuovi]").click();
  await opt.waitForFunction(() => document.querySelectorAll("#righe tr[data-id]").length === 2);
  const putPrima = await sw.evaluate(() => self.__log.filter((x) => x.metodo === "PUT").length);
  await opt.click("#btnPubblica");
  await opt.locator("#stato").filter({ hasText: "Vetrina pubblicata" }).waitFor({ timeout: 60000 });
  const log = await sw.evaluate(() => self.__log);
  const putDopo = log.filter((x) => x.metodo === "PUT").length;
  verifica(putDopo - putPrima === 1, "ripubblicazione: solo vetrina.json, immagini già presenti non ricaricate", putDopo - putPrima);
  verifica(log.some((x) => x.metodo === "DELETE" && x.path.endsWith(`${v[2].id}.jpg`)), "immagine della carta tolta eliminata dal repo");
  verifica(await opt.isHidden("#daPubblicare"), "options: dopo la pubblicazione l'avviso sparisce");

  // --- dal Ledger: "Aggiungi e pubblica" in un passo solo
  await page.locator(`.tessera[data-link="${urlProdotto("OP01-024")}"]`).click();
  await page.locator("#scheda a.apri[data-vetrina]").filter({ hasText: "✓ In vetrina (3)" }).waitFor();
  verifica(true, "Ledger: la carta già presente mostra \"✓ In vetrina (3)\"");
  await page.locator("#scheda a.apri[data-vetrina]").click();
  form = page.locator("#cm-tracker-vetrina form");
  await form.waitFor();
  await form.locator("button[value=pubblica]").click();
  await form.locator("[data-esito]").filter({ hasText: /pubblicata|non riuscita/ }).waitFor({ timeout: 60000 });
  const esitoLedger = await form.locator("[data-esito]").textContent();
  console.log("      " + esitoLedger.replace(/\n/g, " "));
  const jsonDopo = await sw.evaluate(() => JSON.parse(decodeURIComponent(escape(atob(self.__repo.get("vetrina/vetrina.json").content)))));
  verifica(/✓ .*Vetrina pubblicata/.test(esitoLedger) && jsonDopo.carte.find((c) => c.id === v[0].id).quantita === 4,
    "Ledger: \"Aggiungi e pubblica\" aggiunge e pubblica, con conferma", jsonDopo.carte.map((c) => c.quantita));
  verifica((await form.locator("[data-esito] a").first().getAttribute("href")) === "https://loops9.github.io/tracker/vetrina/", "Ledger: la conferma porta alla vetrina pubblica");
  await page.screenshot({ path: path.join(OUT, "ledger-pubblicata.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // file pubblicati, per la verifica visiva della pagina
  const repoFinale = await sw.evaluate(() => Object.fromEntries([...self.__repo].map(([k, x]) => [k, x.content])));
  const sito = path.join(OUT, "sito-pubblicato");
  fs.rmSync(sito, { recursive: true, force: true });
  for (const f of ["index.html", "vetrina.css", "vetrina.js"]) {
    fs.mkdirSync(path.join(sito, "vetrina"), { recursive: true });
    fs.copyFileSync(path.join(RADICE, "vetrina", f), path.join(sito, "vetrina", f));
  }
  for (const [k, b64] of Object.entries(repoFinale)) {
    fs.mkdirSync(path.dirname(path.join(sito, k)), { recursive: true });
    fs.writeFileSync(path.join(sito, k), Buffer.from(b64, "base64"));
  }

  // popup: il nuovo pulsante apre la gestione (se è già aperta Chrome la
  // porta solo in primo piano, quindi prima la chiudo)
  await opt.close();
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${idEst}/popup.html`);
  const [nuova] = await Promise.all([ctx.waitForEvent("page"), popup.click("#btnVetrina")]);
  await nuova.waitForLoadState();
  verifica(nuova.url().endsWith("/options.html"), "popup: 'Gestisci vetrina' apre la pagina options", nuova.url());

  await ctx.close();
  return sito;
}

// ----------------------------------------------------------- C. pagina

async function scaricaImmagine(file, dest) {
  const r = await fetch(CDN + file, { headers: { Referer: "https://www.cardmarket.com/" } });
  if (!r.ok) throw new Error("CDN " + r.status + " " + file);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

async function preparaSitoEsempio() {
  const sito = path.join(OUT, "sito-esempio");
  const v = path.join(sito, "vetrina");
  fs.rmSync(sito, { recursive: true, force: true });
  fs.mkdirSync(path.join(v, "img"), { recursive: true });
  for (const f of ["index.html", "vetrina.css", "vetrina.js"]) fs.copyFileSync(path.join(RADICE, "vetrina", f), path.join(v, f));
  // la pagina esistente, per controllare che continui a funzionare
  for (const f of ["index.html", "data.json", "sw.js"]) fs.copyFileSync(path.join(RADICE, f), path.join(sito, f));

  const carte = [
    ["Monkey.D.Luffy", "OP13-118", "Carrying on His Will", "Secret Rare", "NM", "Inglese", 1, 24.9, "OP13/857338/857338.jpg", false],
    ["Monkey.D.Luffy (Anime Art)", "EB02-061", "Anime 25th Collection", "Super Rare", "NM", "Inglese", 2, 6.5, "EB02/823515/823515.jpg", false],
    ["Monkey.D.Luffy", "OP15-002", "Adventure on Kami's Island", "Leader", "EX", "Inglese", 1, 1.2, "OP15/879905/879905.jpg", false],
    ["Ryuma", "OP06-086", "Promo", "Promo", "NM", "Giapponese", 1, 12, "P/823249/823249.jpg", false],
    ["Monkey.D.Luffy (Pre-Release)", "ST01-012", "Promo", "Promo", "LP", "Giapponese", 3, 3.4, "P-JP/847921/847921.jpg", false],
    ["Monkey.D.Luffy (Magazine)", "P-033", "Promo", "Promo", "NM", "Giapponese", 1, 45, "UP-JP/853300/853300.jpg", true],
    ["Carta senza immagine", "OP02-001", "Paramount War", "Leader", "GD", "Francese", 1, 0.8, null, false],
  ];
  const out = [];
  for (let i = 0; i < carte.length; i++) {
    const [nome, codice, espansione, rarita, condizione, lingua, quantita, prezzo, img, venduta] = carte[i];
    const id = "esempio" + i;
    if (img) await scaricaImmagine(img, path.join(v, "img", id + ".jpg"));
    out.push({ id, nome, codice, espansione, rarita, condizione, lingua, quantita, prezzo, immagine: img ? `img/${id}.jpg` : null, venduta });
  }
  fs.writeFileSync(path.join(v, "vetrina.json"), JSON.stringify({ versione: 1, aggiornatoIl: "2026-11-09T09:30:00.000Z", carte: out }, null, 2));
  return sito;
}

async function testPagina(browser, sito, prefisso) {
  const { server, base } = await serviStatico(sito);
  for (const tema of ["light", "dark"]) {
    for (const larghezza of [390, 1280]) {
      const ctx = await browser.newContext({ viewport: { width: larghezza, height: 900 }, colorScheme: tema, deviceScaleFactor: larghezza === 390 ? 2 : 1 });
      const page = await ctx.newPage();
      const errori = [];
      page.on("console", (m) => m.type() === "error" && errori.push(m.text()));
      page.on("pageerror", (e) => errori.push(String(e)));
      await page.goto(base + "/vetrina/");
      await page.locator(".carta").first().waitFor();
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      const nome = `${prefisso}-${larghezza}-${tema}.png`;
      await page.screenshot({ path: path.join(OUT, nome), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      verifica(overflow <= 0, `${nome}: nessuno scorrimento orizzontale`, overflow);
      verifica(errori.length === 0, `${nome}: nessun errore in console (CSP compresa)`, errori);
      await ctx.close();
    }
  }
  server.close();
}

async function testComportamentoPagina(browser, sito) {
  console.log("\nC. Pagina vetrina");
  const { server, base } = await serviStatico(sito);
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await page.goto(base + "/vetrina/");
  await page.locator(".carta").first().waitFor();

  const carte = await page.$$eval(".carta", (els) => els.map((e) => ({
    nome: e.querySelector(".nome").textContent,
    prezzo: e.querySelector(".prezzo").textContent,
    venduta: e.classList.contains("venduta"),
    bollo: e.querySelector(".bollo")?.textContent || null,
    link: e.querySelector("a.paga")?.href || null,
  })));
  verifica(carte[0].prezzo.replace(/\s/g, " ") === "0,80 €", "ordinamento predefinito: prezzo crescente", carte.map((c) => c.prezzo));
  const ultima = carte[carte.length - 1];
  verifica(ultima.venduta && ultima.bollo === "Venduta" && ultima.link === null, "venduta in fondo, con etichetta e senza pulsante", ultima);
  verifica(carte.filter((c) => !c.venduta).every((c) => /^https:\/\/paypal\.me\/tommasoloops\/\d+\.\d{2}EUR$/.test(c.link)), "link PayPal nel formato richiesto", carte.map((c) => c.link));
  verifica(carte.some((c) => c.link === "https://paypal.me/tommasoloops/24.90EUR"), "24,90 € → .../24.90EUR");
  verifica(/Aggiornata il 9 novembre 2026/.test(await page.textContent("#aggiornata")), "data dell'ultimo aggiornamento in cima", await page.textContent("#aggiornata"));
  verifica(/scrivimi indicando la carta/.test(await page.textContent(".invito")), "invito a scrivere dopo il pagamento");

  await page.selectOption("#ordina", "prezzo-desc");
  const disc = await page.$$eval(".carta .prezzo", (els) => els.map((e) => e.textContent));
  verifica(disc[0].startsWith("24,90") && disc[disc.length - 1].startsWith("45,00"), "prezzo decrescente, venduta comunque in fondo", disc);
  await page.selectOption("#ordina", "nome");
  const perNome = await page.$$eval(".carta .nome", (els) => els.map((e) => e.textContent));
  verifica(perNome[0] === "Carta senza immagine", "ordinamento per nome", perNome);

  await page.fill("#cerca", "ryuma");
  verifica(await page.locator(".carta").count() === 1, "ricerca per nome");
  await page.fill("#cerca", "op13");
  verifica(await page.locator(".carta").count() === 1, "ricerca per codice");
  await page.fill("#cerca", "giapponese");
  verifica(await page.locator(".carta").count() === 3, "ricerca per lingua");
  await page.fill("#cerca", "zzz");
  verifica(await page.locator(".carta").count() === 0 && await page.isVisible("#messaggio"), "nessun risultato → messaggio");

  const cookie = await page.context().cookies();
  const storage = await page.evaluate(() => localStorage.length + sessionStorage.length);
  verifica(cookie.length === 0 && storage === 0, "nessun cookie né storage");
  const esterni = [];
  page.on("request", (r) => !r.url().startsWith(base) && esterni.push(r.url()));
  await page.reload();
  await page.locator(".carta").first().waitFor();
  verifica(esterni.length === 0, "nessuna richiesta verso domini esterni", esterni);

  // stati: json mancante, vuoto, senza carte, rotto
  const stati = { mancante: null, vuoto: "", "senza-carte": '{"versione":1,"aggiornatoIl":"2026-11-09T09:30:00Z","carte":[]}', rotto: "{non json" };
  for (const [nome, contenuto] of Object.entries(stati)) {
    await page.route("**/vetrina/vetrina.json", (r) => contenuto === null
      ? r.fulfill({ status: 404, body: "<h1>404</h1>", contentType: "text/html" })
      : r.fulfill({ status: 200, body: contenuto, contentType: "application/json" }));
    await page.reload();
    await page.locator("#messaggio:not([hidden])").waitFor();
    const testo = await page.textContent("#messaggio");
    const atteso = nome === "rotto" ? /Non riesco a caricare/ : /non ci sono carte/;
    verifica(atteso.test(testo) && await page.locator(".carta").count() === 0 && await page.isHidden("#strumenti"), `vetrina.json ${nome} → messaggio pulito`, testo);
    if (nome === "vuoto") await page.screenshot({ path: path.join(OUT, "vetrina-vuota-390.png") });
    await page.unroute("**/vetrina/vetrina.json");
  }

  // la pagina esistente continua a funzionare
  const errori = [];
  const ledger = await browser.newPage();
  ledger.on("pageerror", (e) => errori.push(String(e)));
  await ledger.goto(base + "/index.html");
  await ledger.waitForFunction(() => document.querySelectorAll("img").length > 5, null, { timeout: 15000 });
  verifica(errori.length === 0, "index.html (Ledger) si carica senza errori con data.json", errori);
  for (const tema of ["light", "dark"]) {
    for (const larghezza of [390, 1280]) {
      const c = await browser.newContext({ viewport: { width: larghezza, height: 900 }, colorScheme: tema });
      const pg = await c.newPage();
      await pg.goto(base + "/index.html");
      await pg.waitForFunction(() => document.querySelectorAll(".tessera").length > 5);
      await pg.waitForTimeout(800);
      await pg.screenshot({ path: path.join(OUT, `ledger-${larghezza}-${tema}.png`) });
      if (larghezza === 1280) {
        await pg.locator(".tessera").nth(2).click();
        await pg.waitForTimeout(300);
        await pg.screenshot({ path: path.join(OUT, `ledger-scheda-${tema}.png`) });
      }
      await c.close();
    }
  }
  await ledger.locator(".tessera").first().click();
  await ledger.locator("#scheda a.apri").waitFor();
  verifica(await ledger.locator("#scheda a[data-vetrina]").count() === 0, "Ledger senza estensione (amici): nessun pulsante \"Metti in vetrina\"");
  await ledger.keyboard.press("Escape");
  // il service worker del Ledger non deve intercettare la vetrina
  await ledger.waitForFunction(() => navigator.serviceWorker.controller || new Promise((r) => setTimeout(() => r(true), 3000)));
  await ledger.reload();
  const servitaDaSw = await ledger.evaluate(async () => {
    const r = await fetch("vetrina/vetrina.json");
    return { sw: !!navigator.serviceWorker.controller, cache: await caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys())))).then((l) => l.flat().map((q) => q.url)), ok: r.ok };
  });
  verifica(servitaDaSw.sw && !servitaDaSw.cache.some((u) => u.includes("/vetrina/")), "sw.js del Ledger attivo ma non mette in cache /vetrina/", servitaDaSw);
  server.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    await testFixture(browser);
    const sitoPubblicato = await testEstensione();
    const sitoEsempio = await preparaSitoEsempio();
    await testComportamentoPagina(browser, sitoEsempio);
    console.log("\nScreenshot");
    await testPagina(browser, sitoEsempio, "vetrina");
    await testPagina(browser, sitoPubblicato, "vetrina-pubblicata");
  } finally {
    await browser.close();
  }
  console.log(`\n  ${ok} ok, ${ko} ko  (screenshot in ${OUT})`);
  process.exit(ko ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
