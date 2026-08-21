# ✅ VERIFICA COMPLETA FIX SCHEDA 001 + PROSSIMI PASSI

## 📊 Valutazione del risultato

### ✅ CONFERMATO: i fix sono stati applicati
Il diff di Git mostra ESATTAMENTE 5 blocchi di modifiche:
- +1/-2 (fix 1: socket.auth.middleware)
- +1/-1 (fix 2: db.lifecycle.monitor)
- +1/-1 (fix 3: startup.cleanup)
- +1/-1 (fix 4: bootstrap.startup)
- +3/-4 (fix 5: socket.disconnect.cleanup)

**TOTALE: 5 modifiche = 5 fix attesi ✅**

### ⚠️ ATTENZIONE: comando di verifica incompleto
Il comando `Select-String -Path "server/**/*.js"` in PowerShell **NON supporta il glob `**`** come bash. Il risultato di 5 chiamate trovate è PARZIALE (dovrebbero essere 11 in totale).

**Prova reale**: il fatto che `captureError(error,` NON sia stato trovato è un buon segno, ma per sicurezza esegui il comando corretto.

---

## 📋 STEP 1 — Verifica COMPLETA in PowerShell (comando corretto)

Apri PowerShell nella root del progetto ed esegui:

```powershell
# Verifica 1: NON devono esserci più chiamate sbagliate
Select-String -Path "server\*.js","server\**\*.js" -Pattern "captureError\(error," -Recurse
```

**Risultato atteso:** output VUOTO (nessuna riga).

```powershell
# Verifica 2: TUTTE le chiamate devono avere il formato corretto
Select-String -Path "server\*.js","server\**\*.js" -Pattern "captureError\(" -Recurse | Select-Object -ExpandProperty Line
```

**Risultato atteso:** 11 righe, tutte inizianti con `captureError('nome_evento', error, ...)`:
1. captureError('socket.auth.middleware', error, { socketId: ... })
2. captureError('db.lifecycle.monitor', error, {})
3. captureError('startup.cleanup', error, {})
4. captureError('bootstrap.startup', error, {})
5. captureError('state.release_user_failed', error, { nick })
6. captureError('watchdog.last_seen.update_failed', error, { nick })
7. captureError('socket.disconnect.cleanup', error, { socketId, jti })
8. captureError('socket.event_handler_error', error)
9. captureError('validation.error', error, { path, method })
10. captureError('db.connection.error', err, { readyState })
11. captureError('db.connection.failed', err, { mode })

Se entrambe le verifiche passano → procedi allo STEP 2.

---

## 📋 STEP 2 — Test rapido del server

```powershell
# Avvia il server
npm start
```

**Verifica che:**
- ✅ Il server parta senza errori di sintassi
- ✅ Non ci siano errori relativi a captureError
- ✅ Appaia il log di avvio: `bootstrap.server.started`

Se il server parte → premi `Ctrl+C` per fermarlo e procedi allo STEP 3.

---

## 📋 STEP 3 — Commit

```powershell
git add server/server.js server/controllers/socketController.js
git commit -m "fix(logger): uniforma signature captureError in server.js e socketController.js

- Fix 5 call site con signature sbagliata (error, context) → (event, error, context)
- server.js: 4 fix (socket.auth.middleware, db.lifecycle.monitor, startup.cleanup, bootstrap.startup)
- socketController.js: 1 fix (socket.disconnect.cleanup)
- Verificato con Select-String: zero chiamate con pattern captureError(error,

Refs: SCHEDA 001 - FASE 0 - Audit Sicurezza"
```

---

## 📋 STEP 4 — Passaggio a SCHEDA 002

Una volta fatto il commit, dimmi **"passa alla SCHEDA 002"** e procederemo con:

🎯 **SCHEDA 002 — Rate Limiting Disabilitato su `/api/socket-token`**
- File: `server/server.js` (righe 184-187)
- CVSS: 8.6 (HIGH)
- Problema: `authRateLimiter` e `fingerprintRateLimiter` sono funzioni vuote `next()` con commento "DISABILITATO PER LOAD TEST"
- Impatto: In produzione = nessuna protezione contro brute-force e DoS

---

## 📊 Checklist SCHEDA 001

- [x] Fix applicati (5 call site) — ✅ confermato da git diff
- [ ] Verifica completa con Select-String corretto (STEP 1)
- [ ] Server avviato senza errori (STEP 2)
- [ ] Commit eseguito (STEP 3)
- [ ] Passaggio a SCHEDA 002 (STEP 4)

---

## 🎯 Note importanti emerse da questa sessione

### 1. Il modello locale funziona bene per:
- ✅ Analisi di codice (ha trovato tutti i mismatch)
- ✅ Applicazione di fix puntuali (5/5 applicati)
- ✅ Risposte deterministiche (due analisi identiche)

### 2. Limiti da tenere a mente:
- ⚠️ Usa PowerShell, non bash → `grep` non esiste, serve `Select-String`
- ⚠️ Il glob `**` in PowerShell non funziona come bash → serve `-Recurse`
- ⚠️ A volte mostra "Tried to edit" invece di "Edited" → verificare sempre con git diff

### 3. Best practice per le prossime schede:
- ✅ Chiedere SEMPRE il git diff dopo i fix
- ✅ Usare comandi PowerShell corretti (Select-String con -Recurse)
- ✅ Far verificare a un secondo modello (Gemini) i risultati critici

---