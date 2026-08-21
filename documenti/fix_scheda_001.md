# 🔧 FIX SCHEDA 001 — captureError Signature Mismatch

## 📋 Contesto
Due analisi indipendenti hanno confermato 5 chiamate con signature sbagliata. La firma corretta è:
```
captureError(event, error, context = {})
```
dove:
- `event` = stringa identificativa (es. 'socket.auth.middleware')
- `error` = oggetto Error
- `context` = oggetto opzionale con dettagli aggiuntivi

## 🎯 Obiettivo del fix
Uniformare tutte le 5 chiamate sbagliate al formato corretto, aggiungendo un nome evento significativo per ciascuna.

## 🤖 PROMPT PER AGENTE LOCALE (copia da qui in giù)
```
Applica il seguente fix ai 5 call site di captureError con signature sbagliata.
NON toccare le chiamate già corrette.

### Fix 1: server/server.js — socket.auth.middleware
TROVA:
captureError(error, {
  context: 'socket.auth.middleware',
  socketId: socket.id
});

SOSTITUISCI CON:
captureError('socket.auth.middleware', error, {
  socketId: socket.id
});

### Fix 2: server/server.js — db.lifecycle.monitor
TROVA:
captureError(error, { context: 'db.lifecycle.monitor' });

SOSTITUISCI CON:
captureError('db.lifecycle.monitor', error, {});

### Fix 3: server/server.js — startup.cleanup
TROVA:
captureError(error, { context: 'startup.cleanup' });

SOSTITUISCI CON:
captureError('startup.cleanup', error, {});

### Fix 4: server/server.js — bootstrap.startup
TROVA:
captureError(error, { context: 'bootstrap.startup' });

SOSTITUISCI CON:
captureError('bootstrap.startup', error, {});

### Fix 5: server/controllers/socketController.js — socket.disconnect.cleanup
TROVA:
captureError(error, {
  context: 'socket.disconnect.cleanup',
  socketId: socket.id,
  jti
});

SOSTITUISCI CON:
captureError('socket.disconnect.cleanup', error, {
  socketId: socket.id,
  jti
});

### Verifica post-fix
Dopo aver applicato i 5 fix, esegui questo grep per confermare che NON ci siano più chiamate sbagliate:
grep -rn "captureError(error," server/ --include="*.js"

Il risultato deve essere VUOTO (nessuna occorrenza).

Poi esegui questo grep per confermare che tutte le chiamate abbiano il formato corretto:
grep -rn "captureError(" server/ --include="*.js"

Ogni riga deve iniziare con captureError('nome_evento', error, ...).

Fammi un report finale con:
1. Elenco dei 5 fix applicati (con riga esatta)
2. Output del grep di verifica
3. Conferma che non ci siano più mismatch
```

## ✅ Checklist post-fix
- [ ] 5 fix applicati
- [ ] grep di verifica passato (zero `captureError(error,`)
- [ ] Server avviato senza errori (`npm start`)
- [ ] Test rapido: genera un errore di connessione DB e verifica che il log mostri event name + stack trace corretto
- [ ] Commit: `git commit -m "fix(logger): uniforma signature captureError in server.js e socketController.js"`

## 📌 Nota importante
Se il modello locale ti propone modifiche EXTRA (es. refactor di logger.js, aggiunta di test, ecc.), **RIFIUTALE** in questa fase. Vogliamo SOLO il fix dei 5 call site, niente di più.

---