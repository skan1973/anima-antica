# 🛡️ Piano di Verifica Vulnerabilità — Anima Antica (FASE 1)

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

## 🎯 Priorità FASE 1 (Critico — entro 1 settimana)
- SCHEDA 101: Dual-Store tokenRegistry (Redis + Memory)
- SCHEDA 102: Map In-Memory in socketController
- SCHEDA 103: Atomic Peer Session Join (Lua Redis)
- SCHEDA 104: WebRTC Signaling Hardening (Zod Union)
- SCHEDA 105: Config Centralizzata (Zod + envalid)
- SCHEDA 106: MongoDB Hardening (TLS, indici, pool)
- SCHEDA 107: Redis Hardening (TLS, ACL, scanKeys)
- SCHEDA 108: Logger Hardening (AsyncLocalStorage, LOG_LEVEL)

---

## 🎯 SCHEDA 101 — Dual-Store tokenRegistry (Redis + Memory)
**File target**: `server/tokenRegistry.js`
**CVSS**: 9.0 (CRITICAL)

**Descrizione**: tokenRegistry usa due store indipendenti (Redis + Map in-memory). Se Redis va giù → token in Memory persi al ritorno. Revoca in Memory non propagata a Redis. In cluster multi-pod = incoerenza totale (split-brain garantito).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/tokenRegistry.js e verifica:
1. Esistono davvero due store (Redis + Map in-memory)?
2. Come vengono sincronizzati (o non sincronizzati)?
3. Cosa succede se Redis va giù temporaneamente?
4. La revoca di un token viene propagata a entrambi gli store?
5. Esiste un meccanismo Pub/Sub per invalidazione?

Cita righe specifiche e fammi un report dettagliato. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 102 — Map In-Memory in socketController
**File target**: `server/controllers/socketController.js`
**CVSS**: 9.0 (CRITICAL)

**Descrizione**: socketController usa Map in-memory per: onlineUsers, roomMembers, activePeerSessions, blockedCallersByNick, pendingIncomingCalls, sidToNick, signalRateLimit, snapshotRateLimit. In cluster multi-pod = split-brain, data loss, auth bypass, rate limit bypass.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/controllers/socketController.js e cerca TUTTE le Map/Set in-memory usati come store globale:
- onlineUsers
- roomMembers
- activePeerSessions
- blockedCallersByNick
- pendingIncomingCalls
- sidToNick
- signalRateLimit
- snapshotRateLimit

Per ognuna dimmi:
1. Riga di definizione
2. Come viene usata (read/write/delete)
3. Se c'è un fallback Redis o se è solo in-memory
4. Rischio in cluster multi-pod

Fammi una tabella riassuntiva. NON modificare nulla, solo mappatura completa.
```

---

## 🎯 SCHEDA 103 — Atomic Peer Session Join (Lua Redis)
**File target**: `server/controllers/socketController.js`
**CVSS**: 8.0 (HIGH)

**Descrizione**: Race condition su peerSession.participantSockets Map. Operazione get → modifica Map → set non atomica. Due join simultanei → sovrascrittura, utente perso. Serve Lua script Redis per atomicità.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/controllers/socketController.js nelle righe 260-280 (o dove c'è la logica di attachSocketToSession / join peer session).
Verifica:
1. L'operazione è atomica o c'è un pattern get-modify-set?
2. Cosa succede se due socket fanno join simultaneamente?
3. Esiste già un Lua script Redis per atomicità?
4. C'è un lock o mutex?

Cita righe specifiche e codice esatto. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 104 — WebRTC Signaling Hardening (Zod Union)
**File target**: `server/schemas/socketEventsSchema.js`
**CVSS**: 9.3 (CRITICAL)

**Descrizione**: signalSchema.signalData usa z.any() → zero validazione. Accetta QUALSIASI payload → WebRTC Signal Injection, DoS, Prototype Pollution. Serve Zod discriminated union (offer/answer/ice-candidate/renegotiate/end).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/schemas/socketEventsSchema.js e cerca signalSchema.
Verifica:
1. signalData è definito come z.any() o ha validazione specifica?
2. Esiste una discriminated union per i tipi di segnale (offer, answer, ice-candidate)?
3. C'è validazione su sdp, candidate, type?
4. Ci sono schemi mancanti per eventi critici (callRequest, acceptCall, rejectCall, hangup)?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 105 — Config Centralizzata (Zod + envalid)
**File target**: `server/config.js` + tutti i file che usano process.env
**CVSS**: 7.5 (HIGH)

**Descrizione**: Config frammentata in 10+ file (server.js, redis.js, db.js, logger.js, socketController.js). Impossibile auditare, drift ambienti, secret leakage risk, no schema validation. Serve server/config/index.js centralizzato con Zod + envalid.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Cerca in TUTTI i file della cartella server/ l'uso di process.env.
Per ogni file dimmi:
1. Quali variabili d'ambiente legge
2. Se c'è validazione (tipo, range, default)
3. Se è duplicato in più file

Verifica anche se esiste già un file config/index.js centralizzato.
Fammi una tabella riassuntiva. NON modificare nulla, solo mappatura completa.
```

---

## 🎯 SCHEDA 106 — MongoDB Hardening (TLS, indici, pool)
**File target**: `server/db.js`
**CVSS**: 9.1 (CRITICAL)

**Descrizione**: Nessuna TLS/SSL per connessione MongoDB → credenziali e dati in chiaro. sanitizeFilter: true non protegge da tutti gli injection ($where, $expr, $function). BCRYPT_ROUNDS da env senza validazione (0 = zero sicurezza, 31 = DoS).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/db.js e verifica:
1. La connessione MongoDB usa TLS/SSL (mongodb+srv:// o tls: true)?
2. C'è javascriptEnabled: false per disabilitare $where/$function?
3. BCRYPT_ROUNDS è validato (clamp 10-14, isNaN check)?
4. Ci sono indici su lastSeen, status, blockedUsers?
5. Connection pool è configurato (maxPoolSize, minPoolSize)?
6. C'è graceful shutdown su SIGTERM (mongoose.connection.close())?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 107 — Redis Hardening (TLS, ACL, scanKeys)
**File target**: `server/redis.js`
**CVSS**: 9.1 (CRITICAL)

**Descrizione**: Nessuna TLS/SSL per Redis → credenziali in chiaro. Nessuna autenticazione ACL/password. Nessuna retry strategy/reconnection handling. KEYS command usato in controller (già segnalato in FASE 0). Serve scanKeys helper.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/redis.js e verifica:
1. La connessione Redis usa TLS (rediss://)?
2. C'è autenticazione ACL/password?
3. Esiste retry strategy con exponential backoff + jitter?
4. C'è un health check attivo (PING + INFO memory + latency)?
5. Esiste un helper scanKeys (sostituisce KEYS)?
6. Ci sono due client separati (publisher + subscriber)?
7. C'è graceful shutdown su SIGTERM (client.quit())?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 108 — Logger Hardening (AsyncLocalStorage, LOG_LEVEL)
**File target**: `server/logger.js`
**CVSS**: 7.5 (HIGH)

**Descrizione**: Sync console.log blocking → event loop lag sotto carico. Nessun log level filtering → tutto loggato (debug/info/warn/error) = noise. redact non gestisce Buffer/Uint8Array. LONG_SECRET_PATTERN troppo aggressivo (redige UUID/hash legittimi).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/logger.js e verifica:
1. Usa console.log sync o async transport (pino/winston)?
2. C'è LOG_LEVEL filtering (env + check levelPriority)?
3. redact() gestisce Buffer/Uint8Array?
4. LONG_SECRET_PATTERN ha allowlist per UUID/hash legittimi?
5. C'è AsyncLocalStorage per requestId/traceId correlation?
6. writeLog accetta requestId opzionale?
7. C'è requestLoggerMiddleware per Express?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## ✅ Checklist completamento FASE 1
- [ ] SCHEDA 101 analizzata e fixata
- [ ] SCHEDA 102 analizzata e fixata
- [ ] SCHEDA 103 analizzata e fixata
- [ ] SCHEDA 104 analizzata e fixata
- [ ] SCHEDA 105 analizzata e fixata
- [ ] SCHEDA 106 analizzata e fixata
- [ ] SCHEDA 107 analizzata e fixata
- [ ] SCHEDA 108 analizzata e fixata
- [ ] Commit finale FASE 1
- [ ] Test suite eseguita

---