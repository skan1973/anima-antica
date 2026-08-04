# Unit Tests

Questa cartella contiene test unitari isolati dai flussi end-to-end.

## Cosa coprono

- `banService.test.js`: validazione input IP/durata e chiamate al modello `Ban` con payload/opzioni attese.
- `schemas.test.js`: validazione schema Zod per messaggi e login utente.
- `stateRecovery.test.js`: test di regressione per il recupero dello stato del socket controller dopo scenari reali.

### stateRecovery.test.js

Avvia un server Socket.IO minimale in-process (senza MongoDB né JWT stack), connette client socket reali e verifica le seguenti condizioni:

| Test | Scenario | Verifica |
|------|----------|----------|
| `stato ritorna a libero dopo terminazione esplicita della chiamata (end-call)` | Due client si connettono, avviano una chiamata e uno la termina con `end-call` | Entrambi i client tornano disponibili per nuove chiamate |
| `utente disconnesso viene rimosso dallo stato (disconnessione improvvisa)` | Un client si disconnette improvvisamente | L'utente scompare dalla lista pubblica |
| `stato recupera per il caller rimanente dopo disconnessione improvvisa del peer durante la chiamata` | Un peer si disconnette durante una chiamata attiva | L'altro caller può terminare la chiamata e ricevere nuove chiamate |
| `watchdog di inattività: socket disconnesso forzatamente viene rimosso dallo stato` | Il socket server-side viene disconnesso forzatamente (come farebbe `runStateWatchdog` alla scadenza di `lastSeen`) | L'utente viene rimosso dalla lista in tempo reale |
| `ping/pong: la connessione rimane attiva tramite heartbeat Socket.IO` | Un client rimane connesso senza attività per più cicli di heartbeat | La connessione è ancora attiva grazie al meccanismo ping/pong di Socket.IO |
| `ping/pong: lastSeen viene aggiornato con gli eventi di attività` | Un client in chiamata invia un messaggio (`send-message`) | Il messaggio arriva all'altro partecipante, confermando che `updateLastSeen` è stato invocato |
| `restoreUserStateAfterReconnect frees a stale busy user without an active call` | Un utente occupato si riconnette senza sessione attiva | Lo stato viene ripristinato a `libero` |
| `cleanupBusyUsersOnStartup resets busy users to free on server startup` | Il server si avvia con utenti ancora occupati nel DB | Tutti gli utenti occupati vengono resettati |
| `restoreUserStateAfterReconnect rejects a concurrent reconnect for the same user` | Due riconnessioni simultanee per lo stesso utente | Solo la prima ha successo; la seconda viene rifiutata |
| `simultaneous reconnects for the same user allow only one login` | Due client usano lo stesso session ID | Un solo login ha successo; l'altro riceve errore |
- `stateService.test.js`: compare-and-swap, fallback transazionale e conflitti concorrenti sul cambio stato utente.

## Esecuzione

```bash
npm run test:unit
```

I test di recupero stato simulano gli scenari in modo deterministico senza attese reali di 5 secondi, verificando direttamente le transizioni di stato e la gestione atomica delle riconnessioni.

Per eseguire unit + smoke call test:

```bash
npm run test:all
```
