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

## Esecuzione

```bash
npm run test:unit
```

Per eseguire unit + smoke call test:

```bash
npm run test:all
```
