# 🛡️ Piano di Verifica Vulnerabilità — Anima Antica (FASE 0)

## 📋 Come usare questo file
1. Apri questo file in VS Code
2. Apri Continue (chat laterale)
3. Copia UNA scheda alla volta (da `---` a `---`)
4. Incollala nella chat di Continue
5. L'agente analizza SOLO quel punto e ti dice se è reale
6. Decidete insieme cosa fare → commit → passa alla scheda successiva

## ⚠️ Regole d'oro
- ✅ Una scheda alla volta (non incollare più schede insieme)
- ✅ Chiedi sempre conferma prima di applicare modifiche
- ✅ Fai commit dopo ogni fix verificato
- ❌ NON chiedere di "fixare tutto in una volta"

## 🎯 Priorità FASE 0 (Emergenza — blocca deploy produzione)
- SCHEDA 001: captureError signature mismatch
- SCHEDA 002: Rate Limiting disabilitato
- SCHEDA 003: CORS wildcard risk
- SCHEDA 004: JWT Secret non validato
- SCHEDA 005: KEYS command su Redis
- SCHEDA 006: dotenv non è la prima riga
- SCHEDA 007: bcrypt@6 supply chain risk

---

## 🎯 SCHEDA 001 — captureError Signature Mismatch
**File target**: `server/logger.js` + 10+ call site
**CVSS**: 8.2 (HIGH)

**Descrizione**: La funzione `captureError` è definita con una firma (es. `captureError(error, context)`), ma in metà del codice viene chiamata con argomenti invertiti (`captureError('string', error)`). Questo causa: stack trace persi, fingerprinting rotto, debugging impossibile.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza il file server/logger.js e cerca la definizione della funzione captureError.
Poi cerca TUTTE le chiamate a captureError in questi file:
- server/logger.js
- server/server.js
- server/tokenRegistry.js
- server/controllers/socketController.js
- server/services/sessionService.js
- server/middleware/socketValidator.js
- server/middleware/validator.js
- server/db.js

Per ogni chiamata trovata, dimmi:
1. La firma attesa (definizione)
2. La firma effettivamente usata nella chiamata
3. Se c'è mismatch

Fammi una tabella riassuntiva. NON modificare ancora nulla, solo analisi.
```

---

## 🎯 SCHEDA 002 — Rate Limiting Disabilitato su `/api/socket-token`
**File target**: `server/server.js` (righe 184-187)
**CVSS**: 8.6 (HIGH)

**Descrizione**: I rate limiter `authRateLimiter` e `fingerprintRateLimiter` sono stati disabilitati ("DISABILITATO PER LOAD TEST") e sostituiti con funzioni vuote `next()`. In produzione questo espone a brute-force e DoS.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza il file server/server.js nelle righe 180-200.
Verifica se:
1. authRateLimiter è una funzione vuota (req, res, next) => next()
2. fingerprintRateLimiter è una funzione vuota
3. Esiste un commento tipo "DISABILITATO PER LOAD TEST"
4. Il package.json ha la dipendenza express-rate-limit installata

Dimmi se il rate limiting è realmente disabilitato e quali sono le implicazioni di sicurezza. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 003 — CORS Wildcard Risk (`!origin` allowed)
**File target**: `server/server.js` (righe 247-255)
**CVSS**: 7.5 (HIGH)

**Descrizione**: La callback CORS ritorna `true` quando `!origin` (richieste non-browser come curl, Postman, script). Questo permette attacchi CSRF via WebSocket da origini non valide.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza il file server/server.js nella sezione di configurazione CORS per Express e Socket.io.
Cerca il pattern: if (!origin) return callback(null, true);
Verifica se:
1. In produzione (isProd === true) viene comunque permesso l'accesso senza origin
2. Se esiste una validazione alternativa per richieste non-browser
3. Se la stessa logica è duplicata nella configurazione di Socket.io e PeerJS

Fammi un report dettagliato. NON modificare nulla.
```

---

## 🎯 SCHEDA 004 — JWT Secret Length/Entropy Non Validato
**File target**: `server/server.js` + `server/config.js`
**CVSS**: 9.1 (CRITICAL)

**Descrizione**: La costante `MIN_JWT_SECRET_LENGTH=32` è definita ma MAI usata per validare `jwtSecret` all'avvio. Se il `.env` contiene un secret corto o debole, è possibile un brute-force HS256 in ore/giorni.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/server.js e server/config.js.
Verifica se:
1. Esiste la costante MIN_JWT_SECRET_LENGTH
2. Viene effettivamente usata per validare jwtSecret all'avvio del server
3. C'è un controllo di entropia (non solo lunghezza) sul secret
4. C'è una blocklist di secret deboli (es. "secret", "password", "changeme")
5. Il server fa process.exit(1) se il secret è debole

Dimmi se la validazione è realmente presente o solo dichiarata. NON modificare nulla.
```

---

## 🎯 SCHEDA 005 — `KEYS` Command su Redis (DoS garantito)
**File target**: `server/controllers/socketController.js`
**CVSS**: 8.5 (HIGH)

**Descrizione**: `pubClient.keys(...)` è un comando O(N) bloccante su Redis (single-threaded). In produzione causa freeze del server e DoS garantito.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Cerca in TUTTI i file della cartella server/ l'uso del comando .keys( su client Redis.
Per ogni occorrenza trovata dimmi:
1. File e riga esatta
2. Contesto d'uso (quale funzione)
3. Se è in un percorso critico (richieste utente, loop, ecc.)

Verifica anche se esiste già un helper scanKeys o simile. NON modificare nulla, solo mappatura completa.
```

---

## 🎯 SCHEDA 006 — `dotenv.config()` non è la prima riga
**File target**: `server/server.js` (prime 30 righe)
**CVSS**: 7.0 (HIGH)

**Descrizione**: Se `server.js` importa `redis.js` o `db.js` PRIMA di caricare `dotenv.config()`, le variabili d'ambiente non sono disponibili → Redis/DB disabilitati silenziosamente.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza le prime 30 righe di server/server.js.
Verifica l'ordine esatto:
1. Dove viene chiamato require('dotenv').config() (o simile)
2. Quali altri file vengono importati PRIMA di dotenv
3. Se redis.js, db.js o config.js vengono importati prima di dotenv

Se dotenv non è la PRIMA riga assoluta, dimmi quali variabili d'ambiente potrebbero essere undefined al momento dell'import. NON modificare nulla.
```

---

## 🎯 SCHEDA 007 — `bcrypt@6` con `allowScripts` (Supply Chain Risk)
**File target**: `package.json`
**CVSS**: 8.5 (HIGH)

**Descrizione**: `bcrypt@6.x` richiede `node-gyp` (build nativo) e `allowScripts` permette esecuzione di codice arbitrario durante `npm install`. Inoltre ci sono due librerie bcrypt (`bcrypt` + `bcryptjs`) che creano confusione.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza package.json e verifica:
1. La versione esatta di bcrypt (è 6.x o 5.x?)
2. Se è presente anche bcryptjs (doppia dipendenza)
3. Se esiste un campo "scripts" o "config" con allowScripts
4. La versione di Node richiesta nel campo "engines" (se esiste)
5. Se le dipendenze usano il prefisso ^ (non pinnate)

Fammi un report sulle dipendenze crittografiche. NON modificare nulla.
```

---

## ✅ Checklist completamento FASE 0
- [ ] SCHEDA 001 analizzata e fixata
- [ ] SCHEDA 002 analizzata e fixata
- [ ] SCHEDA 003 analizzata e fixata
- [ ] SCHEDA 004 analizzata e fixata
- [ ] SCHEDA 005 analizzata e fixata
- [ ] SCHEDA 006 analizzata e fixata
- [ ] SCHEDA 007 analizzata e fixata
- [ ] Commit finale FASE 0
- [ ] Deploy bloccato fino a completamento

--- COMPLETATO