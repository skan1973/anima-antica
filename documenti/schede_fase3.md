# 🛡️ Piano di Verifica Vulnerabilità — Anima Antica (FASE 3)

## 📋 Come usare questo file
1. Apri questo file in VS Code
2. Apri Continue (chat laterale)
3. Copia UNA scheda alla volta (da `---` a `---`)
4. Incollala nella chat di Continue
5. L'agente analizza SOLO quel punto e ti dice se è reale/presente
6. Decidete insieme cosa fare → commit → passa alla scheda successiva

## ⚠️ Regole d'oro
- ✅ Una scheda alla volta (non incollare più schede insieme)
- ✅ Chiedi sempre conferma prima di applicare modifiche
- ✅ Fai commit dopo ogni fix verificato
- ❌ NON chiedere di "fixare tutto in una volta"

## 🎯 Priorità FASE 3 (Medio — Mese 1: Observability, Resilienza, Compliance)
- SCHEDA 301: Observability Stack (Prometheus, OTel, Grafana)
- SCHEDA 302: Docker/K8s Hardening (Read-only, dumb-init, healthcheck)
- SCHEDA 303: TURN/STUN Production (Credential rotation, validation)
- SCHEDA 304: Security Headers & CSP Strict (Helmet, nonce, COOP)
- SCHEDA 305: Chaos Engineering & Fault Injection (Toxiproxy, ChaosMesh)
- SCHEDA 306: Documentazione & Runbook (ADR, Threat Model, Incident Response)
- SCHEDA 307: Analisi File Mancanti (docker-compose, main.js, stateService)

---

## 🎯 SCHEDA 301 — Observability Stack (Prometheus, OTel, Grafana)
**File target**: `server/logger.js`, `server/server.js`, `server/redis.js`, `server/db.js`
**CVSS**: N/A (Miglioramento Architetturale)

**Descrizione**: Mancano metriche esposte (Prometheus), distributed tracing (OpenTelemetry) e alerting real-time. Il logging esiste ma è isolato. Serve integrazione per monitorare latency, error rate, pool usage e active sockets.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/logger.js, server/server.js, server/redis.js e server/db.js.
Verifica se:
1. Esiste già un endpoint /metrics per Prometheus (es. prom-client)?
2. OpenTelemetry (OTel) è configurato per tracing (request → socket → Redis → Mongo)?
3. Il logger.js esporta metriche custom (es. contatore errori, latency)?
4. Esistono health check approfonditi (non solo "ok", ma stato pool DB/Redis)?
5. È configurato un sistema di alerting (webhook, Slack, PagerDudy)?

Fammi un report dettagliato sullo stato attuale dell'observability. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 302 — Docker/K8s Hardening
**File target**: `Dockerfile`, `docker-compose.yml`, eventuali file `k8s/`
**CVSS**: 7.5 (HIGH se non applicato)

**Descrizione**: Il Dockerfile attuale manca di: filesystem read-only, dumb-init per signal handling, healthcheck, multi-arch build, .dockerignore, e context di sicurezza (non-root user, seccomp, drop capabilities).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in down):
```
Analizza il file Dockerfile e docker-compose.yml (se esiste).
Verifica se sono presenti:
1. USER node (o non-root) prima di CMD/ENTRYPOINT?
2. ENTRYPOINT con dumb-init o tini?
3. HEALTHCHECK istruito (es. curl /api/health)?
4. Istruzione COPY --chown=node:node?
5. Esiste un file .dockerignore che esclude .git, .env, node_modules, test?
6. Nel docker-compose o k8s: securityContext (runAsNonRoot, drop ALL capabilities, read-only rootfs)?

Cita le righe specifiche dove queste misure sono presenti o mancanti. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 303 — TURN/STUN Production Hardening
**File target**: `server/server.js`, `public/chat.js` (o `public/js/webrtc/`)
**CVSS**: 7.2 (HIGH)

**Descrizione**: Le credential TURN sono statiche o gestite in modo insicuro. Manca la validazione client-side della config TURN (rischio di server TURN malevoli) e la rotation automatica delle credential.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/server.js e public/chat.js (o file webrtc correlati).
Verifica se:
1. Le credential TURN (username/password) sono statiche nel codice o in .env senza rotation?
2. Esiste un job o endpoint per la rotation automatica delle credential TURN?
3. Il client (public/chat.js) valida che l'URL del server TURN sia in una allowlist di domini trusted?
4. iceTransportPolicy è configurabile o forzato in modo sicuro?

Cita righe specifiche. NON modificare nulla, solo analisi.
 in giù):
```
Analizza server/server.js e public/chat.html (o file dove è configurato Helmet).
Verifica se:
1. Helmet è configurato con Content-Security-Policy (CSP) strict?
2. La CSP usa nonce per gli script inline (es. 'nonce-<valore>' )?
3. Sono presenti header aggiuntivi: Permissions-Policy, Cross-Origin-Opener-Policy (COOP), Cross-Origin-Embedder-Policy (COEP), Referrer-Policy?
4. La CSP blocca risorse esterne non necessarie (es. unpkg.com)?

Cita le direttive CSP esatte trovate nel codice. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 04 — Security Headers & CSP Strict
**File target**: `server/server.js`, `public/chat.html`
**CVSS**: 7.0 (HIGH)

**Descrizione**: Mancano header di sicurezza avanzati. La CSP (Content Security Policy) potrebbe essere troppo permissiva o mancare del tutto, esponendo a XSS o data exfiltration.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza server/server.js e public/chat.html (o file dove è configurato Helmet).
Verifica se:
1. Helmet è configurato con Content-Security-Policy (CSP) strict?
2. La CSP usa nonce per gli script inline (es. 'nonce-<valore>' )?
3. Sono presenti header aggiuntivi: Permissions-Policy, Cross-Origin-Opener-Policy (COOP), Cross-Origin-Embedder-Policy (COEP), Referrer-Policy?
4. La CSP blocca risorse esterne non necessarie (es. unpkg.com)?

Cita le direttive CSP esatte trovate nel codice. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 305 — Chaos Engineering & Fault Injection
**File target**: `scripts/test_fault_injection.js`, `docker-compose*.yml`
**CVSS**: N/A (Miglioramento Resilienza)

**Descrizione**: I test di fault injection attuali sono superficiali (manipolano solo un flag interno `isDbReady`). Mancano test reali di network partition, latency, Redis down, e resource exhaustion usando strumenti come Toxiproxy o ChaosMesh.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Analizza scripts/test_fault_injection.js e qualsiasi file docker-compose o di test correlato.
Verifica se:
1. I test simulano fault reali (es. Toxiproxy per latency/drop, non solo flag booleani)?
2. Esistono test per Redis Down / Redis Slow / Redis OOM?
3. Esistono test per Network Partition o packet loss?
4. Esistono test per Resource Exhaustion (pool exhaustion, memory limits)?
5. C'è una configurazione ChaosMesh o simile per l'ambiente di staging?

Fammi un report sui gap di resilienza. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 306 — Documentazione & Runbook
**File target**: Cartella `docs/`, `README.md`
**CVSS**: N/A (Compliance & Operatività)

**Descrizione**: Mancano documenti fondamentali per la manutenibilità e la risposta agli incidenti: Architecture Decision Records (ADR), Incident Response Runbook, Threat Model (STRIDE) e Security Checklist per l'onboarding.

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Esamina la struttura della cartella docs/ (se esiste) e la root del progetto.
Verifica se sono presenti file o sezioni dedicate a:
1. Architecture Decision Records (ADR) per scelte di sicurezza?
2. Incident Response Runbook (cosa fare se Redis va giù, se c'è un leak di JWT, ecc.)?
3. Threat Model (es. analisi STRIDE)?
4. Security Checklist per sviluppatori (onboarding)?

Elenca i file trovati o conferma la loro assenza. NON modificare nulla, solo analisi.
```

---

## 🎯 SCHEDA 307 — Analisi File Mancanti (Gap Audit)
**File target**: `docker-compose.yml`, `public/main.js`, `server/services/stateService.js`, `server/schemas/userLoginSchema.js`, `server/schemas/messageSchema.js`, `server/schemas/callSchema.js`
**CVSS**: Variabile (Dipende dal contenuto)

**Descrizione**: L'audit originale segnala 10 file mancanti all'analisi. I primi 6 sono critici per completare la mappa di sicurezza (es. `stateService.js` gestisce lo stato busy/free e i blockedUsers, `public/main.js` è l'entry point frontend).

**🤖 PROMPT PER AGENTE LOCALE** (copia da qui in giù):
```
Verifica l'esistenza e il contenuto di questi file nel progetto:
1. docker-compose.yml
2. public/main.js
3. server/services/stateService.js
4. server/schemas/userLoginSchema.js
5. server/schemas/messageSchema.js
6. server/schemas/callSchema.js

Per ognuno che esiste:
- Dimmi brevemente cosa fa.
- Segnala se vedi evidenti problemi di sicurezza (es. XSS in main.js, query non indicizzate in stateService.js, schemi Zod mancanti o permissivi).

Se un file non esiste, segnalamelo chiaramente. NON modificare nulla, solo mappatura e analisi superficiale.
```

---

## ✅ Checklist completamento FASE 3
- [ ] SCHEDA 301 analizzata e pianificata
- [ ] SCHEDA 302 analizzata e pianificata
- [ ] SCHEDA 303 analizzata e pianificata
- [ ] SCHEDA 304 analizzata e pianificata
- [ ] SCHEDA 305 analizzata e pianificata
- [ ] SCHEDA 306 analizzata e pianificata
- [ ] SCHEDA 307 analizzata e file mancanti recuperati/verificati
- [ ] Commit finale FASE 3
- [ ] Audit di sicurezza considerato "Completo"

---