const { io } = require("socket.io-client");

async function getSocketToken() {
    const response = await fetch("http://localhost:3000/api/socket-token", {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`TOKEN_HTTP_${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.token !== "string" || !data.token.trim()) {
        throw new Error("TOKEN_INVALID");
    }

    return data.token;
}

async function bootstrap() {
    const [token1, token2] = await Promise.all([getSocketToken(), getSocketToken()]);

    const client1 = io("http://localhost:3000", {
        auth: { token: token1 }
    });
    const client2 = io("http://localhost:3000", {
        auth: { token: token2 }
    });

    // Attendiamo che entrambi siano connessi prima di loggare
    let connected = 0;
    function onConnect() {
        connected++;
        if (connected === 2) {
            console.log("Client connessi, login in corso...");
            client1.emit("user_login", "Utente1");
            client2.emit("user_login", "Utente2");

            // Attendiamo un momento che il login sia processato dal server
            setTimeout(() => {
                console.log("--- Test 1: Inizio Chiamata ---");
                client1.emit("call-request", { targetNick: "Utente2" });
            }, 1000);
        }
    }

    client1.on("connect", onConnect);
    client2.on("connect", onConnect);

    client2.on("incoming-call", (data) => {
        console.log("Client 2 ha ricevuto chiamata da:", data.callerNick);
        console.log("--- Test 2: Accettazione Chiamata ---");
        client2.emit("accept-call", { callerSocketId: data.callerSocketId });
    });

    client1.on("call-accepted", () => {
        console.log("Client 1: Chiamata accettata");
        setTimeout(() => {
            console.log("--- Test 3: Chiamata terminata dal Client 1 ---");
            client1.emit("end-call");
        }, 1000);
    });

    client2.on("call-ended", (msg) => {
        console.log("Client 2 ha ricevuto terminazione:", msg);
        console.log("Test completato con successo.");
        process.exit(0);
    });

    // Timeout di sicurezza
    setTimeout(() => {
        console.log("Test fallito: Timeout");
        process.exit(1);
    }, 5000);
}

bootstrap().catch((error) => {
    console.error("Bootstrap test fallito:", error.message || error);
    process.exit(1);
});
