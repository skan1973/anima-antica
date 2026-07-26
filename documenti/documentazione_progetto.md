Progetto: Piattaforma VideoChat "ANIMA ANTICA"
1. Descrizione Generale

"ANIMA ANTICA" è una piattaforma di videochat in tempo reale basata su browser. L'interfaccia si distingue per uno sfondo a cielo notturno stellato con la luna crescente sul margine destro.
2. Architettura Funzionale
A. Pagina Principale

    Header: Titolo "ANIMA ANTICA" con caratteri multicolore (arcobaleno).

    Controlli Header:

        Tasto Login/Registrazione (verde con scritta rossa): Apre un menu a tendina per inserire Nick, Password e Sesso (o login diretto).

        Tasto Webcam On/Off (blu con scritta rossa): Attiva/disattiva il flusso video locale.

    Body: Griglia di riquadri contenenti:

        Fermo immagine (snapshot) della webcam dell'utente.

        Nickname dell'utente.

        Bandiera di provenienza.

B. Sistema di Comunicazione Privata

    Avvio: Cliccando sul riquadro di un altro utente, si apre una pagina di videochat privata (lato chiamante e lato chiamato).

    Interfaccia Chat Privata:

        Video dell'interlocutore in modalità full-screen.

        Riquadro piccolo in alto a destra con la propria webcam.

        Barra in basso per messaggi testuali e invio.

        Canale audio attivo in tempo reale.

    Gestione Chiamate:

        Il chiamato riceve una notifica per accettare o rifiutare la chiamata.

        Se il chiamato rifiuta, la pagina del chiamante si chiude e appare un messaggio di avviso.

        Se il chiamato è "Occupato" (già in altra conversazione), il chiamante riceve un avviso.

        Le notifiche di chiamata in entrata appaiono come finestre "toast" poco invasive in basso a destra.

        Possibilità di bloccare definitivamente utenti molesti.

3. Stack Tecnologico Consigliato

    Back-end: Node.js con Express e Socket.io (per la comunicazione in tempo reale).

    Front-end: HTML5, CSS3 (layout responsivo), JavaScript (ES6+).

    Video/Audio: WebRTC (Peer-to-Peer) via librerie come PeerJS.

    Database: MongoDB o PostgreSQL (gestione utenti, login, lista blocchi).

    Sicurezza: HTTPS obbligatorio (requisito browser per webcam) e crittografia password (bcrypt).