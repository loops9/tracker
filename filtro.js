// Confronto fra il filtro scritto a mano e il testo di un'inserzione.
//
// Il confronto letterale fallisce su differenze che per un venditore sono
// irrilevanti: "psa 10" non trova "PSA 10.0", "PSA-10", "psa10" o "PSA 10 GEM MT".
// Qui il testo viene ridotto a una sequenza di token confrontabili:
//
//   "PSA 10.0 GEM MT"  ->  ["psa", "10", "gem", "mt"]
//   "psa10"            ->  ["psa", "10"]
//   "PSA-10,0"         ->  ["psa", "10"]
//
// I numeri sono confrontati per valore, quindi 10 == 10.0 == 10,0 ma 10 != 100.

function normalizzaTesto(testo) {
  return String(testo == null ? '' : testo)
    .toLowerCase()
    // accenti: "édition" -> "edition"
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // separatore decimale unico: "10,0" -> "10.0"
    .replace(/(\d),(\d)/g, '$1.$2')
    // tutto ciò che non è lettera, cifra o punto diventa spazio
    .replace(/[^a-z0-9.]+/g, ' ')
    // "psa10" -> "psa 10", "10psa" -> "10 psa"
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map(function (t) {
      // numero: confronto per valore, così "10.0" e "10" coincidono
      if (/^\d+(\.\d+)?$/.test(t)) return String(parseFloat(t));
      // parola: i punti residui non contano ("mint." -> "mint")
      return t.replace(/\./g, '');
    })
    .filter(Boolean);
}

// L'inserzione passa il filtro se contiene tutti i token scritti dall'utente
// (ognuno consumato una volta sola: "10 10" richiede due dieci).
function corrispondeFiltro(testoInserzione, filtro) {
  var cercati = normalizzaTesto(filtro);
  if (!cercati.length) return true; // filtro vuoto: nessun vincolo

  var disponibili = normalizzaTesto(testoInserzione);
  for (var i = 0; i < cercati.length; i++) {
    var pos = disponibili.indexOf(cercati[i]);
    if (pos === -1) return false;
    disponibili.splice(pos, 1);
  }
  return true;
}

if (typeof module !== 'undefined') module.exports = { normalizzaTesto: normalizzaTesto, corrispondeFiltro: corrispondeFiltro };
