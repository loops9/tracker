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
function serviFixture() {
  const server = http.createServer((req, res) => {
    const file = fixturePer(new URL(req.url, "http://x").pathname);
    res.writeHead(file ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(file ? fs.readFileSync(file) : "fixture mancante");
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
    for (const f of ["estrai.js", "vetrina-core.js", "vetrina-content.js"]) {
      await page.addScriptTag({ path: path.join(RADICE, f) });
    }
    return page.evaluate(async () => {
      const r = await estraiPrezzoMinimoItalia(null);
      return { ...r, mercato: calcolaMarketPrice(r.prezzi), dati: leggiDatiProdottoCardmarket(document, location) };
    });
  }

  const cinque = await estrai("OP01-024");
  verifica(JSON.stringify(cinque.prezzi) === "[2,2.1,2.4,3.5,9.99]", "5 inserzioni italiane, la tedesca ignorata, aria-label/title/data-original-title", cinque.prezzi);
  verifica(cinque.mercato.marketPrice === 2.17 && cinque.mercato.marketSampleSize === 3, "3+ inserzioni → media dei 3 più bassi = 2,17", cinque.mercato);
  verifica(cinque.prezzo === 2 && cinque.media3 === 2.17, "campi esistenti prezzo/media3 invariati", [cinque.prezzo, cinque.media3]);
  verifica(cinque.immagineUrl === CDN + "OP13/857338/857338.jpg", "immagine scelta per codice nell'alt", cinque.immagineUrl);
  verifica(cinque.dati.nome === "Monkey.D.Luffy" && cinque.dati.codice === "OP01-024", "nome e codice dalla pagina", cinque.dati);
  verifica(cinque.dati.espansione === "Romance Dawn" && cinque.dati.rarita === "Super Rare", "espansione e rarità (icona) dalla pagina", cinque.dati);

  const due = await estrai("OP01-016");
  verifica(due.mercato.marketPrice === 4.63 && due.mercato.marketSampleSize === 2, "meno di 3 inserzioni → media di 2 = 4,63", due.mercato);

  const zero = await estrai("OP05-119");
  verifica(zero.mercato.marketPrice === null && zero.mercato.marketSampleSize === 0 && !zero.bloccato, "zero inserzioni → null, non bloccato", zero);

  const virgola = await estrai("OP09-001");
  verifica(JSON.stringify(virgola.prezzi) === "[999.99,1000,1234.56,6199]", "prezzi con virgola decimale e punto delle migliaia", virgola.prezzi);
  verifica(virgola.mercato.marketPrice === 1078.18, "media 999,99 / 1.000,00 / 1.234,56 = 1.078,18", virgola.mercato);

  const cf = await estrai("CF-0001");
  verifica(cf.bloccato === true && cf.prezzi === undefined, "sfida Cloudflare (\"Just a moment\") → bloccato", cf);
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
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await ctx.route("https://www.cardmarket.com/**", servFixture);

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const idEst = new URL(sw.url()).host;
  await sw.evaluate(installaGitHubFinto);
  const vetrina = () => sw.evaluate(async () => (await chrome.storage.local.get("vetrina")).vetrina || []);

  // --- pulsante "Metti in vetrina"
  const page = await ctx.newPage();
  async function aggiungi(url, quantita, lingua) {
    await page.goto(url);
    const lancia = page.locator("#cm-tracker-vetrina .lancia");
    await lancia.waitFor({ timeout: 10000 });
    await lancia.click();
    const form = page.locator("#cm-tracker-vetrina form");
    await form.waitFor();
    await form.locator("input[name=quantita]").fill(String(quantita));
    if (lingua) await form.locator("select[name=lingua]").selectOption(lingua);
    return form;
  }

  let form = await aggiungi(urlProdotto("OP01-024", "?sellerCountry=17"), 2, "Inglese");
  verifica(await form.locator("input[name=nome]").inputValue() === "Monkey.D.Luffy", "modulo precompilato con il nome");
  verifica(await form.locator("input[name=codice]").inputValue() === "OP01-024", "modulo precompilato con il codice");
  verifica((await form.locator("input[name=immagineUrl]").inputValue()).endsWith("857338.jpg"), "modulo precompilato con l'immagine");
  await page.screenshot({ path: path.join(OUT, "cardmarket-modulo.png") });
  await form.locator("button[type=submit]").click();
  await form.locator("[data-esito]").filter({ hasText: "Aggiunta" }).waitFor();
  verifica(/2,17 €/.test(await form.locator("[data-esito]").textContent()), "pagina già filtrata sull'Italia → prezzo subito calcolato");

  form = await aggiungi(urlProdotto("OP01-024"), 1, "Inglese");
  await form.locator("button[type=submit]").click();
  await form.locator("[data-esito]").filter({ hasText: "già in vetrina" }).waitFor();

  form = await aggiungi(urlProdotto("OP01-016"), 1, "Giapponese");
  await form.locator("button[type=submit]").click();
  await form.locator("[data-esito]").filter({ hasText: "Aggiorna prezzi" }).waitFor();
  form = await aggiungi(urlProdotto("OP05-119"), 1);
  await form.locator("button[type=submit]").click();
  await form.locator("[data-esito]").filter({ hasText: "Aggiunta" }).waitFor();

  let v = await vetrina();
  verifica(v.length === 3 && v[0].quantita === 3, "doppione (stesso URL, condizione, lingua) → quantità sommata", v.map((c) => c.quantita));
  verifica(v.every((c) => c.url.startsWith("https://www.cardmarket.com/it/") && !c.url.includes("?")), "URL salvati puliti e in italiano", v.map((c) => c.url));
  verifica(v[1].lingua === "Giapponese" && v[1].condizione === "NM", "condizione e lingua scelte nel modulo", v[1]);

  // --- pagina options
  const opt = await ctx.newPage();
  opt.on("dialog", (d) => d.accept());
  await opt.goto(`chrome-extension://${idEst}/options.html`);
  await opt.locator("#righe tr[data-id]").first().waitFor();
  verifica(await opt.locator("#righe tr[data-id]").count() === 3, "options: 3 righe");

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

  // --- aggiorna prezzi (apre le pagine finte una alla volta, con le pause vere)
  const fixtureServer = await serviFixture();
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
  verifica(durata >= 3 * 5 + 2 * 4, "stesse pause dello scraping esistente (5 s dopo il caricamento + 4–9 s tra le carte)", durata);

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
