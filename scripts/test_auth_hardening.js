// scripts/test_auth_hardening.js
const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function getSocketToken() {
  const response = await fetch(`${SERVER_URL}/api/socket-token`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`TOKEN_HTTP_${response.status}`);
  }
  const data = await response.json();
  if (!data || typeof data.token !== 'string' || !data.token.trim()) {
    throw new Error('TOKEN_INVALID');
  }
  return data.token;
}

async function revokeToken(token) {
  const response = await fetch(`${SERVER_URL}/api/socket-token/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  return response.json();
}

async function testRevoca() {
  console.log("--- Test 1: Revoca Token ---");
  
  const token = await getSocketToken();
  console.log("Token ottenuto:", token.substring(0, 20) + "...");
  
  const revokeStatus = await revokeToken(token);
  console.log("Stato revoca:", revokeStatus);
  
  if (revokeStatus.revoked) {
    console.log("✅ PASS: Token revocato correttamente.");
    return true;
  } else {
    console.log("❌ FAIL: Revoca non riuscita.");
    return false;
  }
}

async function testReplayAttack() {
  console.log("\n--- Test 2: Replay Attack (tentativo connessione con token revocato) ---");
  
  // 1. Ottieni un token valido
  const token = await getSocketToken();
  console.log("Token valido ottenuto:", token.substring(0, 20) + "...");
  
  // 2. Revoca il token
  const revokeStatus = await revokeToken(token);
  console.log("Token revocato:", revokeStatus.revoked);
  
  if (!revokeStatus.revoked) {
    console.log("❌ FAIL: Impossibile revocare il token per il test.");
    return false;
  }
  
  // 3. Tentativo di connessione Socket.IO con il token revocato
  return new Promise((resolve) => {
    let testPassed = false;
    let timeoutId = null;
    
    const socket = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket']
    });
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (socket.connected) socket.disconnect();
    };
    
    timeoutId = setTimeout(() => {
      cleanup();
      console.log("❌ FAIL: Timeout - nessun errore ricevuto");
      resolve(false);
    }, 5000);
    
    socket.on('connect_error', (error) => {
      console.log("Errore di connessione ricevuto:", error.message);
      
      // Il replay dovrebbe essere bloccato con AUTH_REVOKED o AUTH_REPLAY_DETECTED
      if (error.message === 'AUTH_REVOKED' || error.message === 'AUTH_REPLAY_DETECTED' || 
          error.message === 'Authentication failed: session revoked' ||
          error.message === 'Authentication failed: session already active') {
        console.log("✅ PASS: Replay bloccato correttamente con errore:", error.message);
        testPassed = true;
      } else {
        console.log("❌ FAIL: Errore inaspettato:", error.message);
        testPassed = false;
      }
      cleanup();
      resolve(testPassed);
    });
    
    socket.on('connect', () => {
      cleanup();
      console.log("❌ FAIL: Connessione riuscita nonostante il token revocato!");
      resolve(false);
    });
  });
}

async function testConcorrenza() {
  console.log("\n--- Test 3: Connessioni Concorrenti con stesso token ---");
  
  // 1. Ottieni un token valido
  const token = await getSocketToken();
  console.log("Token valido ottenuto:", token.substring(0, 20) + "...");
  
  // 2. Crea due connessioni concorrenti con lo stesso token
  let firstConnected = false;
  let secondConnected = false;
  let firstError = null;
  let secondError = null;
  
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
    
    const checkResult = () => {
      if (settled) return;
      
      // Se almeno una connessione è riuscita, il test è fallito
      if (firstConnected || secondConnected) {
        cleanup();
        settled = true;
        console.log("❌ FAIL: Una delle connessioni concorrenti è riuscita!");
        resolve(false);
        return;
      }
      
      // Se entrambe hanno ricevuto errori, controlliamo che siano quelli giusti
      if (firstError && secondError) {
        cleanup();
        settled = true;
        
        const validErrors = ['AUTH_REPLAY_DETECTED', 'Authentication failed: session already active'];
        const firstValid = validErrors.some(e => firstError.includes(e));
        const secondValid = validErrors.some(e => secondError.includes(e));
        
        if (firstValid && secondValid) {
          console.log("✅ PASS: Entrambe le connessioni concorrenti sono state bloccate correttamente.");
          console.log("  - Prima connessione:", firstError);
          console.log("  - Seconda connessione:", secondError);
          resolve(true);
        } else {
          console.log("❌ FAIL: Errori non corretti per le connessioni concorrenti.");
          console.log("  - Prima connessione:", firstError);
          console.log("  - Seconda connessione:", secondError);
          resolve(false);
        }
      }
    };
    
    timeoutId = setTimeout(() => {
      cleanup();
      if (!settled) {
        settled = true;
        console.log("❌ FAIL: Timeout - nessuna risposta ricevuta");
        resolve(false);
      }
    }, 8000);
    
    const socket1 = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket']
    });
    
    const socket2 = io(SERVER_URL, {
      auth: { token },
      transports: ['websocket']
    });
    
    socket1.on('connect_error', (error) => {
      firstError = error.message;
      console.log("Client 1 errore:", firstError);
      socket1.disconnect();
      checkResult();
    });
    
    socket2.on('connect_error', (error) => {
      secondError = error.message;
      console.log("Client 2 errore:", secondError);
      socket2.disconnect();
      checkResult();
    });
    
    socket1.on('connect', () => {
      firstConnected = true;
      console.log("Client 1 connesso (non dovrebbe succedere!)");
      checkResult();
    });
    
    socket2.on('connect', () => {
      secondConnected = true;
      console.log("Client 2 connesso (non dovrebbe succedere!)");
      checkResult();
    });
  });
}

async function testAuthHardening() {
  console.log("=".repeat(60));
  console.log("TEST DI SICUREZZA AUTH - Revoca e Replay");
  console.log("=".repeat(60));
  
  let passed = 0;
  let total = 0;
  
  // Test 1: Revoca
  total++;
  if (await testRevoca()) passed++;
  
  // Test 2: Replay Attack
  total++;
  if (await testReplayAttack()) passed++;
  
  // Test 3: Connessioni Concorrenti
  total++;
  if (await testConcorrenza()) passed++;
  
  console.log("\n" + "=".repeat(60));
  console.log(`RISULTATO FINALE: ${passed}/${total} test superati`);
  console.log("=".repeat(60));
  
  if (passed === total) {
    console.log("✅ ✅ ✅ PASS: 100% scenari replay/revoke vengono bloccati.");
    process.exit(0);
  } else {
    console.log(`❌ ❌ ❌ FAIL: Solo ${passed}/${total} test superati.`);
    process.exit(1);
  }
}

testAuthHardening().catch((error) => {
  console.error("Errore durante l'esecuzione dei test:", error);
  process.exit(1);
});