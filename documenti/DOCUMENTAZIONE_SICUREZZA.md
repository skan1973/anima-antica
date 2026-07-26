# Resoconto Progetto ANIMA ANTICA

Questo documento riassume lo stato attuale del progetto, le protezioni implementate e la tabella di marcia per lo sviluppo lato client.

---

## 1. Stato del Progetto (Backend Blindato)
Abbiamo ristrutturato il server per garantire massima sicurezza, modularità e stabilità.

### Sicurezza Implementata:
- **Modularizzazione**: Logica socket isolata in `server/controllers/socketController.js`.
- **Protezione XSS**: Sanificazione rigorosa di ogni input (messaggi, nickname) tramite funzione helper.
- **Autorizzazioni**: Controllo lato server delle relazioni di blocco (`blockedUsers`) prima di ogni chiamata.
- **Anti-Abuso**:
    - **Cooldown**: Limite di 3 secondi tra le chiamate.
    - **Moderazione**: Sistema di avvisi progressivi per utenti bloccati che tentano di chiamare.
    - **Ban Temporaneo**: Ban automatico di 30 minuti dopo 3 tentativi di molestia, con tracciamento nei log (`[AVVISO]`, `[BAN]`).
- **Privacy WebRTC**:
    - **PeerServer Privato**: Il signaling non passa più per server terzi, ma è ospitato sulla porta 9000 del tuo server.
    - **Stanze Private**: Utilizzo del metodo "Server-Managed" con `socket.join()` e validazione `roomId` su ogni segnale.
- **Stabilità**: Gestione asincrona (`try...catch`) per tutte le operazioni sul database MongoDB.

---

## 2. Roadmap Sviluppo Lato Client (TODO)

Per completare l'applicazione, dovrai implementare le seguenti funzionalità nel frontend:

### A. Gestione Dinamica Video
- [ ] Creare dinamicamente elementi `<video>` nella `video-grid` quando arriva un flusso (`call.on('stream')`).
- [ ] Implementare la logica di rimozione del video al termine della chiamata o alla disconnessione (`call.on('close')`).

### B. Integrazione Signaling e Stato
- [ ] Memorizzare la `roomId` ricevuta dall'evento `call-accepted`.
- [ ] Assicurarsi che ogni `emit` di signaling contenga la `roomId` corretta per le nuove protezioni server-side.

### C. Gestione Chat e Video
- [ ] Implementare la transizione di pagina (o visibilità dei componenti) tra `index.html` e `chat.html`.
- [ ] Visualizzare i messaggi ricevuti (`receive-message`) nel contenitore dedicato.

### D. UX e Feedback
- [ ] Aggiornare dinamicamente l'elenco utenti online (`update_user_list`).
- [ ] Disabilitare il pulsante "Chiama" se l'utente è occupato o se l'utente bloccato ha subito un ban.
- [ ] Visualizzazione del badge "BAN" (già pronto nel codice `chat.js`, verifica il selettore CSS/ID).

---

## 3. Note Tecniche per il Deploy
- **Porte**: Assicurati che il firewall del server esponga la porta **3000** (Express) e la porta **9000** (PeerServer).
- **SSL/TLS**: Obbligatorio per far funzionare l'accesso alla webcam in produzione.
- **Variabili**: Ricordati di impostare `CLIENT_ORIGIN` e `MONGO_URI` nel file `.env` sul server remoto.
