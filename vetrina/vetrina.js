// Vetrina pubblica: legge vetrina.json (scritto dall'estensione) e mostra le
// carte in vendita. Nessuna dipendenza, nessun cookie, nessun tracciamento.

var PAYPAL_UTENTE = 'tommasoloops';

// https://paypal.me/tommasoloops/12.50EUR (punto decimale, sempre due cifre)
function linkPaypal(prezzo) {
  if (typeof prezzo !== 'number' || !isFinite(prezzo) || prezzo <= 0) return null;
  return 'https://paypal.me/' + PAYPAL_UTENTE + '/' + prezzo.toFixed(2) + 'EUR';
}

function senzaAccenti(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Tiene solo le voci ben formate: il file è pubblico e non deve poter rompere la pagina.
function carteValide(dati) {
  if (!dati || !Array.isArray(dati.carte)) return [];
  return dati.carte.filter(function (c) {
    return c && typeof c.nome === 'string' && c.nome &&
      typeof c.prezzo === 'number' && isFinite(c.prezzo) && c.prezzo > 0;
  });
}

// Tutte le parole cercate devono comparire in nome, codice, espansione, rarità, lingua o condizione.
function filtraCarte(carte, ricerca) {
  var parole = senzaAccenti(ricerca).split(/\s+/).filter(Boolean);
  if (!parole.length) return carte.slice();
  return carte.filter(function (c) {
    var testo = senzaAccenti([c.nome, c.codice, c.espansione, c.rarita, c.lingua, c.condizione].join(' '));
    return parole.every(function (p) { return testo.indexOf(p) !== -1; });
  });
}

// Le vendute vanno sempre in fondo; dentro ogni gruppo vale l'ordinamento scelto.
function ordinaCarte(carte, criterio) {
  var perNome = function (a, b) { return a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }); };
  return carte.slice().sort(function (a, b) {
    if (!!a.venduta !== !!b.venduta) return a.venduta ? 1 : -1;
    if (criterio === 'nome') return perNome(a, b) || a.prezzo - b.prezzo;
    if (criterio === 'prezzo-desc') return b.prezzo - a.prezzo || perNome(a, b);
    return a.prezzo - b.prezzo || perNome(a, b);
  });
}

// Solo immagini salvate nella cartella img/ accanto alla pagina.
function percorsoImmagineSicuro(p) {
  return typeof p === 'string' && /^img\/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$/.test(p) ? p : null;
}

// ----------------------------------------------------------------- pagina

var formatoEuro = typeof Intl !== 'undefined'
  ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
  : null;

function euro(v) {
  return formatoEuro ? formatoEuro.format(v) : v.toFixed(2).replace('.', ',') + ' €';
}

function el(tag, classe, testo) {
  var e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo != null) e.textContent = testo;
  return e;
}

function tessera(c) {
  var art = el('article', 'carta' + (c.venduta ? ' venduta' : ''));

  var figura = el('div', 'figura');
  var src = percorsoImmagineSicuro(c.immagine);
  var segnaposto = el('div', 'segnaposto', c.codice || c.nome);
  if (src) {
    var img = document.createElement('img');
    img.src = src;
    img.alt = c.nome;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = function () { img.remove(); figura.appendChild(segnaposto); };
    figura.appendChild(img);
  } else {
    figura.appendChild(segnaposto);
  }
  if (c.venduta) figura.appendChild(el('span', 'bollo', 'Venduta'));
  art.appendChild(figura);

  var corpo = el('div', 'corpo');
  corpo.appendChild(el('h2', 'nome', c.nome));
  var dettagli = [c.codice, c.rarita].filter(Boolean).join(' · ');
  if (c.espansione && c.espansione !== c.rarita) dettagli += (dettagli ? ' — ' : '') + c.espansione;
  if (dettagli) corpo.appendChild(el('p', 'dettagli', dettagli));

  var etichette = el('div', 'etichette');
  [c.condizione, c.lingua].filter(Boolean).forEach(function (t) {
    etichette.appendChild(el('span', 'etichetta', t));
  });
  if (etichette.childNodes.length) corpo.appendChild(etichette);

  var piede = el('div', 'piede-carta');
  var riga = el('div', 'prezzo-riga');
  riga.appendChild(el('span', 'prezzo', euro(c.prezzo)));
  if (!c.venduta) {
    var q = c.quantita > 0 ? c.quantita : 1;
    riga.appendChild(el('span', 'disponibili', q === 1 ? '1 disponibile' : q + ' disponibili'));
  }
  piede.appendChild(riga);

  var link = linkPaypal(c.prezzo);
  if (!c.venduta && link) {
    var a = el('a', 'paga', 'Acquista con PayPal');
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', 'Acquista ' + c.nome + ' a ' + euro(c.prezzo) + ' con PayPal');
    piede.appendChild(a);
  }
  corpo.appendChild(piede);
  art.appendChild(corpo);
  return art;
}

function mostraMessaggio(testo) {
  var m = document.getElementById('messaggio');
  m.textContent = testo;
  m.hidden = false;
  document.getElementById('strumenti').hidden = true;
  document.getElementById('conteggio').textContent = '';
  document.getElementById('griglia').replaceChildren();
}

function scriviAggiornata(iso) {
  var d = new Date(iso);
  if (!iso || isNaN(d)) return;
  document.getElementById('aggiornata').textContent = 'Aggiornata il ' + d.toLocaleString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function avvia() {
  var griglia = document.getElementById('griglia');
  var cerca = document.getElementById('cerca');
  var ordina = document.getElementById('ordina');
  var conteggio = document.getElementById('conteggio');
  var messaggio = document.getElementById('messaggio');
  var tutte = [];

  function disegna() {
    var visibili = ordinaCarte(filtraCarte(tutte, cerca.value), ordina.value);
    var frammento = document.createDocumentFragment();
    visibili.forEach(function (c) { frammento.appendChild(tessera(c)); });
    griglia.replaceChildren(frammento);

    var inVendita = visibili.filter(function (c) { return !c.venduta; }).length;
    conteggio.textContent = inVendita === 1 ? '1 carta disponibile' : inVendita + ' carte disponibili';
    if (!visibili.length) {
      messaggio.textContent = 'Nessuna carta corrisponde alla ricerca.';
      messaggio.hidden = false;
    } else {
      messaggio.hidden = true;
    }
  }

  cerca.addEventListener('input', disegna);
  ordina.addEventListener('change', disegna);

  fetch('vetrina.json', { cache: 'no-cache' })
    .then(function (r) {
      if (r.status === 404) return null; // non ancora pubblicata
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    })
    .then(function (testo) {
      return testo && testo.trim() ? JSON.parse(testo) : null;
    })
    .then(function (dati) {
      if (dati) scriviAggiornata(dati.aggiornatoIl);
      tutte = carteValide(dati);
      if (!tutte.length) {
        mostraMessaggio('Al momento non ci sono carte in vetrina. Ripassa più tardi.');
        return;
      }
      document.getElementById('strumenti').hidden = false;
      disegna();
    })
    .catch(function () {
      mostraMessaggio('Non riesco a caricare la vetrina in questo momento. Riprova tra qualche minuto.');
    });
}

if (typeof module !== 'undefined') {
  module.exports = {
    linkPaypal: linkPaypal,
    carteValide: carteValide,
    filtraCarte: filtraCarte,
    ordinaCarte: ordinaCarte,
    percorsoImmagineSicuro: percorsoImmagineSicuro,
  };
} else {
  avvia();
}
