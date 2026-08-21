// scripts/test_pubsub.js
const io = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

/**
 * Ottiene un token valido dal server
 * @returns {Promise<string>}
 */
async function getSocketToken() {
  const response = await fetch(`${SERVER_URL}/api/socket-token`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Impossibile ottenere il token: ${response.status}`);
  }
  const data = await response.json();
  return data.token;
}

async function testPubSub() {
  console.log("--- Test Cross-Node Pub/Sub ---");

  try {
    // Ottieni token reali per entrambi i client
    const token1 = await getSocketToken();
    const token2 = await getSocketToken();

    console.log("Token client 1 ottenuto:", token1.substring(0, 20) + "...");
    console.log("Token client 2 ottenuto:", token2.substring(0, 20) + "...");

    // Crea due client con token reali
    const client1 = io(SERVER_URL, {
      auth: { token: token1 },
      transports: ['websocket']
    });

    const client2 = io(SERVER_URL, {
      auth: { token: token2 },
      transports: ['websocket']
    });

    let client1Ready = false;
    let client2Ready = false;
    let testPassed = false;

    client1.on('connect', () => {
      console.log("Client 1 connesso, join stanza: test-room");
      client1.emit('join-room', 'test-room');
      client1Ready = true;
    });

    client2.on('connect', () => {
      console.log("Client 2 connesso, join stanza: test-room");
      client2.emit('join-room', 'test-room');
      client2Ready = true;

      // Attendi che entrambi i client siano pronti
      setTimeout(() => {
        if (client1Ready && client2Ready) {
          console.log("Client 2 invia messaggio a test-room");
          client2.emit('msg-test', 'Ciao da client 2');
        } else {
          console.log("Attenzione: client non tutti pronti per il test");
        }
      }, 1500);
    });

    client1.on('receive-msg-test', (msg) => {
      console.log("Client 1 ricevuto messaggio:", msg);
      testPassed = true;
      console.log("✅ TEST PASSED: Pub/Sub funziona correttamente");
      
      // Cleanup
      client1.disconnect();
      client2.disconnect();
      process.exit(0);
    });

    // Timeout per evitare che il test rimanga in sospeso
    setTimeout(() => {
      if (!testPassed) {
        console.log("❌ TEST FAILED: Timeout - nessun messaggio ricevuto");
        client1.disconnect();
        client2.disconnect();
        process.exit(1);
      }
    }, 10000);

    // Gestione errori di connessione
    client1.on('connect_error', (err) => {
      console.error("Client 1 errore di connessione:", err.message);
      process.exit(1);
    });

    client2.on('connect_error', (err) => {
      console.error("Client 2 errore di connessione:", err.message);
      process.exit(1);
    });

  } catch (error) {
    console.error("Errore durante il test:", error.message);
    process.exit(1);
  }
}

testPubSub();