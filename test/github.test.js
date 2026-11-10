const test = require("node:test");
const assert = require("node:assert/strict");
const gh = require("../github.js");

const cfg = { githubOwner: "loops9", githubRepo: "tracker", githubToken: "t" };

// fetch finto: risponde con la sequenza data e registra le richieste
function finto(risposte) {
  const chiamate = [];
  global.fetch = async (url, opz = {}) => {
    chiamate.push({ url, metodo: opz.method || "GET", corpo: opz.body ? JSON.parse(opz.body) : null });
    const [status, corpo] = risposte.shift();
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
  };
  return chiamate;
}

test("token mancante: messaggio chiaro, nessuna richiesta", async () => {
  const chiamate = finto([]);
  await assert.rejects(gh.verificaAccessoGitHub({ githubOwner: "a", githubRepo: "b" }), /Token GitHub mancante/);
  await assert.rejects(gh.scriviFileGitHub({ githubToken: "x" }, "f", "", "m"), /Utente o repository/);
  assert.equal(chiamate.length, 0);
});

test("token non valido (401)", async () => {
  finto([[401, { message: "Bad credentials" }]]);
  await assert.rejects(gh.verificaAccessoGitHub(cfg), /non valido o scaduto/);
});

test("token in sola lettura", async () => {
  finto([[200, { permissions: { push: false } }]]);
  await assert.rejects(gh.verificaAccessoGitHub(cfg), /non scriverci/);
});

test("file nuovo: PUT senza sha sul branch main", async () => {
  const c = finto([[404, {}], [201, { content: { path: "vetrina/vetrina.json" } }]]);
  await gh.scriviFileGitHub(cfg, "vetrina/vetrina.json", "e30=", "msg");
  assert.equal(c[1].metodo, "PUT");
  assert.equal(c[1].url, "https://api.github.com/repos/loops9/tracker/contents/vetrina/vetrina.json");
  assert.deepEqual(c[1].corpo, { message: "msg", content: "e30=", branch: "main" });
});

test("conflitto di sha: rilegge lo sha e riprova una volta", async () => {
  const c = finto([[200, { sha: "vecchio" }], [409, { message: "does not match" }], [200, { sha: "nuovo" }], [200, { content: {} }]]);
  await gh.scriviFileGitHub(cfg, "vetrina/vetrina.json", "e30=", "msg");
  assert.equal(c[1].corpo.sha, "vecchio");
  assert.equal(c[3].corpo.sha, "nuovo");
});

test("conflitto ripetuto: errore comprensibile", async () => {
  finto([[200, { sha: "a" }], [409, {}], [200, { sha: "b" }], [409, {}]]);
  await assert.rejects(gh.scriviFileGitHub(cfg, "vetrina/vetrina.json", "", "m"), /Conflitto su vetrina\/vetrina.json.*Riprova/);
});

test("422 per sha mancante (file creato nel frattempo) conta come conflitto", async () => {
  const c = finto([[404, {}], [422, { message: "\"sha\" wasn't supplied." }], [200, { sha: "x" }], [200, {}]]);
  await gh.scriviFileGitHub(cfg, "f.json", "", "m");
  assert.equal(c[3].corpo.sha, "x");
});

test("URL della vetrina su Pages", () => {
  assert.equal(gh.urlPagesVetrina({ githubOwner: "Loops9", githubRepo: "tracker" }), "https://loops9.github.io/tracker/vetrina/");
});

test("lettura file JSON: sha dalla Contents API, contenuto dal blob con lo stesso sha", async () => {
  const chiamate = [];
  global.fetch = async (url, opz = {}) => {
    chiamate.push({ url, accept: opz.headers?.Accept });
    if (url.includes("/contents/")) return { ok: true, status: 200, json: async () => ({ sha: "abc" }) };
    return { ok: true, status: 200, text: async () => '{"carte":[]}' };
  };
  const r = await gh.leggiFileJsonGitHub(cfg, "data.json");
  assert.deepEqual(r, { sha: "abc", json: { carte: [] } });
  assert.equal(chiamate[1].url, "https://api.github.com/repos/loops9/tracker/git/blobs/abc");
  assert.equal(chiamate[1].accept, "application/vnd.github.raw+json");
});

test("lettura file JSON che non esiste", async () => {
  finto([[404, {}]]);
  assert.deepEqual(await gh.leggiFileJsonGitHub(cfg, "data.json"), { sha: null, json: null });
});

test("scrittura condizionata: conflitto di sha restituisce null invece di sovrascrivere", async () => {
  const c = finto([[409, { message: "data.json does not match abc" }]]);
  assert.equal(await gh.scriviSeInvariatoGitHub(cfg, "data.json", "e30=", "m", "abc"), null);
  assert.equal(c.length, 1);
  assert.equal(c[0].corpo.sha, "abc");
});

test("scrittura condizionata riuscita restituisce il nuovo sha", async () => {
  finto([[200, { content: { sha: "def" } }]]);
  assert.equal(await gh.scriviSeInvariatoGitHub(cfg, "data.json", "e30=", "m", "abc"), "def");
});
