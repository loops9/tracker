const {corrispondeFiltro, normalizzaTesto} = require('./filtro.js');
let ok=0, ko=0;
function t(filtro, testo, atteso) {
  const r = corrispondeFiltro(testo, filtro);
  if (r === atteso) { ok++; console.log(`  OK   "${filtro}" ${atteso?'trova':'ignora'} "${testo}"`); }
  else { ko++; console.log(`  KO   "${filtro}" vs "${testo}": atteso ${atteso}, ottenuto ${r}`); }
}
console.log('deve trovare:');
t('psa 10','PSA 10.0',true);
t('psa 10','PSA 10',true);
t('psa 10','psa10',true);
t('psa 10','PSA-10',true);
t('psa 10','PSA 10,0',true);
t('psa 10','Graded PSA 10 GEM MT',true);
t('psa 10','carta PSA10.0 come nuova',true);
t('psa10','PSA 10.0',true);
t('PSA 10','psa 10.00',true);
t('psa 9.5','PSA 9,5',true);
t('bgs 9.5','BGS 9.5 Gem Mint',true);
t('sealed','Sealed / Sigillato',true);
t('sealed','SEALED',true);
t('','qualsiasi cosa',true);
t('prima edizione','Prima Edizione ITA',true);
console.log('\nnon deve trovare:');
t('psa 10','PSA 9',false);
t('psa 10','PSA 100',false);
t('psa 10','BGS 10',false);
t('psa 10','PSA 1',false);
t('psa 10','solo la custodia PSA vuota',false);
t('psa 9.5','PSA 9',false);
t('psa 10','psa 10 richiesto? no, questa e 9',true); // contiene comunque "psa 10"
t('sealed','carta singola',false);
console.log('\nnormalizzazione:');
[['PSA 10.0'],['psa10'],['PSA-10,0'],['BGS 9,5 Gem'],['Prima Edizione!']].forEach(([s])=>
  console.log('  ',JSON.stringify(s),'->',JSON.stringify(normalizzaTesto(s))));
console.log('\n  '+ok+' ok, '+ko+' ko');
process.exit(ko?1:0);
