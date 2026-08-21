# 🛡️ Piano di Verifica Vulnerabilità — Anima Antica (FASE 2)

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

## 🎯 Priorità FASE 2 (Alto — settimana 2-3)
- SCHEDA 201: Session Service Refactor (Factory + DI + Concurrency)
- SCHEDA 202: Schemi Auth Completi Centralizzati
- SCHEDA 203: Validator Middleware Refactor
- SCHEDA 204: Frontend Modulare & Sicuro
- SCHEDA 205: Test Suite Sicurezza Completa
- SCHEDA 206: Dependency Hardening (package.json)

---

## 🎯 SCHEDA 201 — Session Service Refactor (Factory + DI + Concurrency)
**File target**: `server/services/sessionService.js`
**CVSS**: 7.5 (HIGH)

**Descrizione**: sessionService.js ha diversi problemi: error swallowing in revokeSession (catch ritorna `{revoked: false}` nascondendo JWT scaduto, firma invalida, Redis down), nessuna concurrency control (session flooding, account sharing non rilevato), nessun logging strutturato, req parameter unused, no input validation su ttlSeconds, fingerprint solo IP+UA (fragile su mobile/NAT), no Refresh Token / Rotation, JWT type non verificato in middleware, revoca API non forza disconnect socket.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/services/sessionService.js e verifica:
1. La funzione revokeSession ha un catch che ritorna { revoked: false } nascondendo errori reali?
2. Esiste un limite al numero di sessioni attive per fingerprint/nick?
3. C'è logging strutturato (writeLog/captureError) o solo console.log?
4. Il parametro req viene usato o è inutilizzato?
5. ttlSeconds viene validato (tipo, range, NaN check)?
6. Il fingerprint include solo IP+UA o anche deviceId?
7. Esiste un meccanismo di Refresh Token / Rotation?
8. Il middleware verifica il campo "type" del JWT?
9. Quando un token viene revocato, il socket corrispondente viene forzatamente disconnesso (io.to(socketId).disconnect())?

Cita righe specifiche e codice esatto. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 202 — Schemi Auth Completi Centralizzati
**File target**: `server/schemas/authSchema.js`
**CVSS**: 7.0 (HIGH)

**Descrizione**: In authSchema.js esiste solo socketTokenRevokeSchema. Mancano completamente: loginSchema, registerSchema, refreshTokenSchema, mfaChallengeSchema, deviceRegisterSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema. Inoltre token: z.string().min(1) non valida il formato JWT (3 parti base64url). Questo porta a validazione inconsistente e superficie di attacco ampia.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/schemas/authSchema.js e verifica:
1. Quali schemi sono effettivamente definiti (elenca tutti gli exports)?
2. Esistono: loginSchema, registerSchema, refreshTokenSchema, mfaChallengeSchema, deviceRegisterSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema?
3. socketTokenRevokeSchema valida il formato JWT (3 parti base64url separate da .) o solo z.string().min(1)?
4. Ci sono regex centralizzate per NICK_REGEX, PASSWORD_REGEX, JWT_PATTERN?
5. Gli schemi usano .strict() per rifiutare campi extra?
6. Esiste un file authSchemas.js (plurale) alternativo?

Cerca anche in TUTTI i file della cartella server/ dove vengono validati login/register/refresh per capire se la validazione è inline e inconsistente.
Fammi una tabella riassuntiva. NON modificare nulla, solo mappatura completa.
```

---

## 🎯 SCHEDA 203 — Validator Middleware Refactor
**File target**: `server/middleware/validator.js`
**CVSS**: 7.0 (HIGH)

**Descrizione**: validator.js ha captureError chiamato con signature sbagliata (stesso bug sistemico di logger.js), validazione troppo permissiva (schema.parse({body, query, params}) richiede schema che definisca tutti e tre, altrimenti query/params accettati senza validazione), nessuna validazione Headers/Cookies, error response espone dettagli Zod (received, expected → information leakage), nessun rate limit su validazione fallita, schemas export espone solo socketTokenRevoke, nessun requestId correlation, next(error) per errori non-Zod può causare crash.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/middleware/validator.js e verifica:
1. captureError viene chiamato con la signature corretta o invertita?
2. Lo schema valida separatamente body/query/params/headers/cookies o tutto insieme?
3. Gli schemi usano .strict() per rifiutare campi extra?
4. L'error response 400 espone dettagli Zod (received, expected, path)?
5. C'è validazione su Headers (Auth, Content-Type) e Cookies?
6. C'è rate limit su validation error per prevenire DoS?
7. C'è requestId correlation nei log?
8. next(error) per errori non-Zod può causare crash?
9. Quali schemi sono esportati e usati?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 204 — Frontend Modulare & Sicuro
**File target**: `public/chat.js`
**CVSS**: 8.2 (HIGH)

**Descrizione**: public/chat.js ha problemi critici: parametri sensibili in URL (callToken JWT, roomId, nick → log server, proxy, browser history, Referer header), nessuna validazione config TURN/WebRTC da server (TURN malevoli → traffico intercettato), peer.call()/call.answer() senza verifica callToken lato callee (attacker risponde a chiamata non sua), PeerJS path hardcoded /peerjs/myapp, getUserMedia senza constraints specifiche, reconnection logic senza jitter → thundering herd, heartbeat ping senza pong timeout, localVideo.play() silent fail, endCallBtn redirect hardcoded /, nessun cleanup peer.destroy() su disconnect/error → memory leak, sendMessage senza limite lunghezza → DoS.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza public/chat.js e verifica:
1. callToken, roomId, nick sono passati via URL (query string) o via sessionStorage/headers?
2. La config TURN/WebRTC viene validata lato client (domini trusted) o accettata ciecamente dal server?
3. Quando il callee riceve una chiamata, verifica che call.metadata.callToken corrisponda al proprio callToken?
4. Il path PeerJS è hardcoded (/peerjs/myapp) o configurabile?
5. getUserMedia() ha constraints specifiche (risoluzione, frame rate, deviceId)?
6. La logica di reconnection ha jitter per evitare thundering herd?
7. L'heartbeat ping ha un timeout/pong check?
8. localVideo.play().catch() è gestito o silenzioso?
9. endCallBtn fa redirect hardcoded a "/" o usa routing?
10. peer.destroy() viene chiamato su disconnect/error per cleanup?
11. sendMessage ha un limite di lunghezza?
12. Il file è monolitico (tutto in un file) o modulare?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 205 — Test Suite Sicurezza Completa
**File target**: `scripts/test_auth_hardening.js` + `scripts/test_fault_injection.js`
**CVSS**: 7.5 (HIGH)

**Descrizione**: I test di sicurezza esistenti hanno gap critici: nessun test JWT Algorithm Confusion (alg: none, CVSS 9.0), nessun test Weak/Short JWT Secret (CVSS 8.5), nessun test Fingerprint Binding (IP/UA Rotation, CVSS 8.0), nessun test Rate Limiting Auth Endpoint (CVSS 7.5), nessun test Token Rotation/Refresh/Reuse Detection (CVSS 7.0). Inoltre verificano solo error message string (fragile), nessun cleanup garantito su timeout, test concorrenza non verifica stato server-side, timeout hardcoded → flaky su CI, nessun setup/teardown globale. test_fault_injection.js testa solo flag interno (dbReady), non comportamento reale, usa forceDbStatus esportato da produzione (pericolo), zero test su Redis Fault, zero test su Network Partition, zero test su Resource Exhaustion.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza scripts/test_auth_hardening.js e scripts/test_fault_injection.js e verifica:
1. Esistono test per JWT Algorithm Confusion (alg: none, RS256 al posto di HS256)?
2. Esistono test per Weak/Short JWT Secret?
3. Esistono test per Fingerprint Binding (IP/UA rotation)?
4. Esistono test per Rate Limiting Auth Endpoint?
5. Esistono test per Token Rotation / Refresh / Reuse Detection?
6. I test verificano solo error message string o anche stato server-side (tokenRegistry.activeSocketId)?
7. C'è setup/teardown globale per isolamento test?
8. I timeout sono hardcoded o configurabili?
9. test_fault_injection.js testa comportamento reale (fetch /api/health, socket connection) o solo flag interni?
10. Esistono test su Redis Fault (down, slow, OOM)?
11. Esistono test su Network Partition / Latency?
12. Esistono test su Resource Exhaustion (pool, memory, FD)?
13. C'è una cartella tests/ con test moderni (Vitest/Jest) o solo scripts/ legacy?

Fammi una tabella riassuntiva con: test presente ✅ / mancante ❌. NON modificare nulla, solo mappatura.
```

---

## 🎯 SCHEDA 206 — Dependency Hardening (package.json)
**File target**: `package.json`
**CVSS**: 8.5 (HIGH)

**Descrizione**: package.json ha problemi critici di supply chain: bcrypt@6.0.0 + allowScripts (supply chain risk, CVSS 8.5), versioni non pinnate con ^ (dependency drift, CVSS 7.5), envalid@8.2.0 installato ma NON USATO in config.js (dead code), mongodb@7.5.0 + mongoose@9.8.0 duplicati, peer@1.0.2 vecchia con CVE note, socket.io@4.7.5 non ultima patch, express-rate-limit@8.6.1 senza store Redis configurato, zod@4.4.3 major v4 breaking da v3 (codice usa API v3), cross-env in dependencies invece di devDependencies, audit:security usa --audit-level=moderate (troppo basso), nessun engines field (build non riproducibile).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza package.json e verifica:
1. La versione di bcrypt è 6.x o 5.x? C'è anche bcryptjs (doppia dipendenza)?
2. Le dipendenze usano il prefisso ^ (non pinnate) o versioni esatte?
3. envalid è installato? Viene effettivamente usato in config.js o server/config/index.js?
4. Ci sono sia mongodb che mongoose? Sono versioni compatibili?
5. peer è peer@1.0.2 o peerjs@1.5.4+?
6. socket.io è 4.7.5 o 4.7.6+?
7. express-rate-limit ha rate-limit-redis come store configurato?
8. zod è v3 o v4? Il codice usa API v3 o v4?
9. cross-env è in dependencies o devDependencies?
10. Lo script audit:security usa --audit-level=moderate o high/critical?
11. Esiste il campo "engines" con versione Node richiesta?
12. Esiste il campo "overrides" per fixare CVE transitive (ws, engine.io, socket.io-parser)?

Cita righe specifiche. NON modificare nulla, solo analisi.
```

---

## ✅ Checklist completamento FASE 2
- [ ] SCHEDA 201 analizzata e fixata
- [ ] SCHEDA 202 analizzata e fixata
- [ ] SCHEDA 203 analizzata e fixata
- [ ] SCHEDA 204 analizzata e fixata
- [ ] SCHEDA 205 analizzata e fixata
- [ ] SCHEDA 206 analizzata e fixata
- [ ] Commit finale FASE 2
- [ ] Test suite eseguita

---