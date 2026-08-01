# Unit Tests

Questa cartella contiene test unitari isolati dai flussi end-to-end.

## Cosa coprono

- `banService.test.js`: validazione input IP/durata e chiamate al modello `Ban` con payload/opzioni attese.
- `schemas.test.js`: validazione schema Zod per messaggi e login utente.
- `stateService.test.js`: compare-and-swap, fallback transazionale e conflitti concorrenti sul cambio stato utente.

## Esecuzione

```bash
npm run test:unit
```

Per eseguire unit + smoke call test:

```bash
npm run test:all
```
