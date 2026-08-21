const db = require('../server/db');

// Forza il DB come non pronto
db.forceDbStatus(false);
console.log("DB status forzato a false.");

// Ora dovremmo testare l'endpoint (es. tramite fetch)
// Poiché non posso chiamare il server live qui, il test sarà logico:
// Se dbReady è false, isDbReady() ritorna false, il middleware restituisce 503.
const isReady = db.isDbReady();
console.log("isDbReady() restituisce:", isReady);
process.exit(isReady ? 1 : 0);

