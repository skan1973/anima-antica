# Piano di Refactoring: ANIMA ANTICA - Sprint 1

Questo documento definisce gli interventi tecnici necessari per portare l'architettura di "ANIMA ANTICA" a un livello di qualità da produzione, migliorando sicurezza, resilienza e manutenibilità.

## 1. Sicurezza e Hardening

### Stato di Verifica
- **Socket Authentication:** Presente e ben strutturata. Il flusso Socket.io usa JWT, controllo di scadenza, revoca, fingerprint del client e rifiuto dei replay.
- **Rate Limiting:** Parzialmente presente. Esiste un limiter per PeerJS, ma non risulta applicato a un percorso `/auth` e nemmeno agli endpoint che rilasciano o revocano i token Socket.io.
- **CSP (Content Security Policy):** Presente, ma da rifinire rispetto alle risorse reali usate dal frontend. Il progetto carica font esterni e script esterni che devono essere allineati alla policy.

### Cose Ancora da Fare
1. Allineare il flusso di autenticazione documentato al flusso reale del progetto, che oggi passa da `/api/socket-token` e non da `/auth`.
2. Applicare rate limiting anche agli endpoint che generano o revocano i token di Socket.io, non solo al servizio PeerJS.
3. Verificare che il CSP consenta solo le risorse davvero necessarie, eliminando o localizzando quelle esterne non indispensabili.
4. Aggiungere test mirati per coprire: rifiuto delle connessioni Socket.io non autorizzate, revoca token, e risposta `429` quando il limite richiesto viene superato.
5. Se l'obiettivo è un hardening rigoroso, valutare la rimozione delle dipendenze esterne non essenziali o la loro sostituzione con asset locali.

## 2. Resilienza dello Stato (Watchdog)

### Stato di Verifica
- **State Auto-Cleanup:** Presente solo in forma parziale. Esiste un watchdog basato su `lastSeen`, ma non risulta un vero ping/pong client-server dedicato e non viene forzato un aggiornamento dello stato nel database quando l'utente diventa inattivo.
- **Atomic Operations:** Refactoring avviato. Le transizioni di stato vengono spostate verso un service dedicato con compare-and-swap e fallback transazionale, riducendo il rischio di conflitti durante chiamate simultanee.

### Cose Ancora da Fare
1. Introdurre un ping/pong esplicito tra client e server per misurare la vitalità reale della sessione.
2. Aggiornare il watchdog in modo che, al timeout, lo stato dell'utente venga riportato a `libero` anche nel database.
3. Spostare il cambio di stato su operazioni atomiche o transazionali, così da ridurre il rischio di incoerenze nelle chiamate simultanee.
4. Verificare che la logica di pulizia gestisca correttamente anche i casi di disconnessione improvvisa e riavvio del server.
5. Aggiungere test di regressione sul recupero stato dopo inattività, disconnessione e terminazione chiamata.

## 3. Ottimizzazione Infrastruttura WebRTC

### Stato di Verifica
- **TURN Server Strategy:** Non risulta ancora configurata una lista esplicita di server STUN/TURN. Il client usa PeerJS con configurazione base e quindi non mostra una strategia di traversamento NAT già definita nel codice.
- **Signaling Security:** Presente in forma parziale e più forte rispetto al baseline. Il server limita PeerJS per IP, disabilita la discovery pubblica e il client valida `roomId` e `callToken`, ma non risulta un vincolo completo e diretto che leghi il `peerId` all'utente autenticato in modo persistente.

### Cose Ancora da Fare
1. Definire e configurare una lista esplicita di server STUN/TURN affidabili per ridurre i fallimenti di handshake dietro NAT rigidi.
2. Spostare la configurazione ICE nel client in modo dichiarato e verificabile, così da non dipendere dalla configurazione di default di PeerJS.
3. Rafforzare l'associazione tra `peerId`, sessione autenticata e identità utente, evitando che un ID possa essere riusato in contesti non autorizzati.
4. Verificare i fallback di connessione e i casi di rete degradata con test dedicati su browser e ambienti reali.
5. Documentare chiaramente quali protezioni sono già server-side e quali devono essere ancora garantite lato client.

## 4. Observability e Logging

### Stato di Verifica
- **Structured Logging:** Presente in modo solido. I log sono JSON strutturati, con redazione dei dati sensibili e gestione centralizzata degli errori. Rimane però una correlazione parziale: il `requestId` viene generato sulle richieste HTTP, ma non risulta propagato in modo uniforme a tutti gli eventi di chiamata e Socket.io.
- **Health Checks:** Presente solo in forma parziale. Esiste `/api/health` per il database, ma non risulta ancora un controllo esplicito della raggiungibilità del servizio Signaling/PeerJS.

### Cose Ancora da Fare
1. Propagare un `correlation-id` unico lungo tutto il flusso HTTP, Socket.io e chiamata, così da ricostruire un evento end-to-end.
2. Uniformare il formato dei log di chiamata con campi stabili per evento, utente, remoto, room e stato della sessione.
3. Aggiungere un health check che verifichi anche il servizio Signaling/PeerJS, non solo la connessione al database.
4. Definire test che confermino la presenza del `requestId`/correlation-id nei punti critici del flusso.
5. Valutare una piccola suite di log assertion, per evitare regressioni nella struttura dei messaggi prodotti.

## 5. Testing

### Stato di Verifica
- **E2E Automation:** Presente solo in forma parziale. Esiste uno smoke test automatico con due client Socket.io e avvio/termine chiamata, ma non risulta ancora uno scenario Playwright completo che verifichi anche lo stato `occupato` e `libero` direttamente nel database.

### Cose Ancora da Fare
1. Convertire lo smoke test attuale in una suite Playwright vera e propria, così da coprire il flusso browser completo.
2. Aggiungere la verifica esplicita dello stato utente nel database dopo l'avvio della chiamata e dopo la terminazione.
3. Includere almeno due sessioni autentiche distinte per simulare utenti reali e non solo client Socket.io raw.
4. Stabilizzare i test con attese e asserzioni affidabili, evitando dipendenze da timing fragile o `setTimeout` non deterministici.
5. Integrare questi test nella pipeline di validazione, così da bloccare regressioni su login, signaling e ripristino stato.

---
*Obiettivo finale: Ridurre il tasso di fallimento delle connessioni (handshake) a < 1% e garantire l'integrità dello stato utente nel Database.*
