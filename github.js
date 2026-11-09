// Scrittura di file nel repo tramite la Contents API di GitHub: stesso
// meccanismo di sincronizzaGitHub (GET dello sha, poi PUT su main), ma
// gli errori vengono restituiti con un messaggio comprensibile invece di
// finire solo nella console.

var GITHUB_BRANCH = "main";

function ErroreGitHub(messaggio, status) {
  var e = new Error(messaggio);
  e.name = "ErroreGitHub";
  e.status = status || null;
  return e;
}

// cfg = { githubOwner, githubRepo, githubToken } come salvati in chrome.storage.local.
function controllaConfigGitHub(cfg) {
  if (!cfg || !cfg.githubToken) {
    throw ErroreGitHub("Token GitHub mancante: inseriscilo nelle impostazioni GitHub.");
  }
  if (!cfg.githubOwner || !cfg.githubRepo) {
    throw ErroreGitHub("Utente o repository GitHub mancanti: completali nelle impostazioni GitHub.");
  }
}

function headersGitHub(cfg) {
  return {
    Authorization: "Bearer " + cfg.githubToken,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function urlContenuti(cfg, path) {
  var p = String(path).split("/").map(encodeURIComponent).join("/");
  return "https://api.github.com/repos/" + cfg.githubOwner + "/" + cfg.githubRepo + "/contents/" + p;
}

async function leggiCorpo(risp) {
  try { return await risp.json(); } catch (e) { return {}; }
}

function messaggioErrore(status, corpo, cosa) {
  var dettaglio = corpo && corpo.message ? " (" + corpo.message + ")" : "";
  if (status === 401) return "Token GitHub non valido o scaduto: generane uno nuovo e salvalo nelle impostazioni.";
  if (status === 403) return "Il token non ha il permesso di scrivere su questo repository" + dettaglio + ".";
  if (status === 404) return "Repository non trovato, oppure il token non può accedervi: controlla utente, repository e permessi del token.";
  if (status === 409) return "Conflitto su " + cosa + ": il file è cambiato su GitHub nel frattempo. Riprova a pubblicare.";
  if (status === 422) return "GitHub ha rifiutato " + cosa + dettaglio + ".";
  return "Errore GitHub " + status + " su " + cosa + dettaglio + ".";
}

// Controlla subito token e permessi, così l'utente non aspetta il caricamento
// delle immagini per scoprire che il token è scaduto.
async function verificaAccessoGitHub(cfg) {
  controllaConfigGitHub(cfg);
  var url = "https://api.github.com/repos/" + cfg.githubOwner + "/" + cfg.githubRepo;
  var risp;
  try {
    risp = await fetch(url, { headers: headersGitHub(cfg), cache: "no-store" });
  } catch (e) {
    throw ErroreGitHub("GitHub non raggiungibile: controlla la connessione.");
  }
  var corpo = await leggiCorpo(risp);
  if (!risp.ok) throw ErroreGitHub(messaggioErrore(risp.status, corpo, "il repository"), risp.status);
  if (corpo.permissions && corpo.permissions.push === false) {
    throw ErroreGitHub("Il token può leggere il repository ma non scriverci: servono i permessi di scrittura (Contents: Read and write).", 403);
  }
  return corpo;
}

// sha del file su main, oppure null se non esiste ancora.
async function leggiShaGitHub(cfg, path) {
  var risp = await fetch(urlContenuti(cfg, path) + "?ref=" + GITHUB_BRANCH, {
    headers: headersGitHub(cfg),
    cache: "no-store",
  });
  if (risp.status === 404) return null;
  var corpo = await leggiCorpo(risp);
  if (!risp.ok) throw ErroreGitHub(messaggioErrore(risp.status, corpo, path), risp.status);
  return corpo.sha || null;
}

// Crea o sostituisce un file. Se lo sha non corrisponde più (409, oppure
// 422 quando il file è comparso tra GET e PUT) rilegge lo sha e riprova una
// volta: succede quando due commit arrivano a ridosso.
async function scriviFileGitHub(cfg, path, contenutoBase64, messaggio) {
  controllaConfigGitHub(cfg);
  for (var tentativo = 0; tentativo < 2; tentativo++) {
    var sha = await leggiShaGitHub(cfg, path);
    var corpo = { message: messaggio, content: contenutoBase64, branch: GITHUB_BRANCH };
    if (sha) corpo.sha = sha;

    var risp;
    try {
      risp = await fetch(urlContenuti(cfg, path), {
        method: "PUT",
        headers: Object.assign({}, headersGitHub(cfg), { "Content-Type": "application/json" }),
        body: JSON.stringify(corpo),
      });
    } catch (e) {
      throw ErroreGitHub("GitHub non raggiungibile durante l'invio di " + path + ".");
    }
    if (risp.ok) return (await leggiCorpo(risp)).content || {};

    var errore = await leggiCorpo(risp);
    var conflittoSha = risp.status === 409 || (risp.status === 422 && /sha/i.test(errore.message || ""));
    if (!conflittoSha || tentativo === 1) {
      throw ErroreGitHub(messaggioErrore(risp.status, errore, path), risp.status);
    }
  }
}

// Elenco dei file di una cartella ([] se la cartella non esiste).
async function elencaCartellaGitHub(cfg, path) {
  var risp = await fetch(urlContenuti(cfg, path) + "?ref=" + GITHUB_BRANCH, {
    headers: headersGitHub(cfg),
    cache: "no-store",
  });
  if (risp.status === 404) return [];
  var corpo = await leggiCorpo(risp);
  if (!risp.ok) throw ErroreGitHub(messaggioErrore(risp.status, corpo, path), risp.status);
  return Array.isArray(corpo) ? corpo : [];
}

async function eliminaFileGitHub(cfg, path, sha, messaggio) {
  var risp = await fetch(urlContenuti(cfg, path), {
    method: "DELETE",
    headers: Object.assign({}, headersGitHub(cfg), { "Content-Type": "application/json" }),
    body: JSON.stringify({ message: messaggio, sha: sha, branch: GITHUB_BRANCH }),
  });
  if (!risp.ok && risp.status !== 404) {
    throw ErroreGitHub(messaggioErrore(risp.status, await leggiCorpo(risp), path), risp.status);
  }
}

function urlPagesVetrina(cfg) {
  return "https://" + String(cfg.githubOwner).toLowerCase() + ".github.io/" + cfg.githubRepo + "/vetrina/";
}

if (typeof module !== "undefined") {
  module.exports = {
    controllaConfigGitHub: controllaConfigGitHub,
    verificaAccessoGitHub: verificaAccessoGitHub,
    leggiShaGitHub: leggiShaGitHub,
    scriviFileGitHub: scriviFileGitHub,
    elencaCartellaGitHub: elencaCartellaGitHub,
    eliminaFileGitHub: eliminaFileGitHub,
    urlPagesVetrina: urlPagesVetrina,
  };
}
