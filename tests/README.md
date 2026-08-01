# Unit Tests

Questa cartella contiene test unitari isolati dai flussi end-to-end.

## Cosa coprono

- `banService.test.js`: validazione input IP/durata e chiamate al modello `Ban` con payload/opzioni attese.
- `schemas.test.js`: validazione schema Zod per messaggi e login utente.
- `stateRecovery.test.js`: recupero stato su riconnessione, cleanup stato all'avvio e race condition su riconnessioni simultanee.
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
