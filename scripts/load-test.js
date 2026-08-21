// scripts/load-test.js
// Load test con generazione di nick univoci

const { io } = require('socket.io-client');

// ============================================================
// CONFIGURAZIONE
// ============================================================
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const USERS = Number.parseInt(process.env.LOAD_TEST_USERS, 10) || 5;
const DURATION = Number.parseInt(process.env.LOAD_TEST_DURATION, 10) || 30;

// ============================================================
// GENERAZIONE UTENTI CON NICK UNIVOCI
// ============================================================
function generateFakeUsers(count) {
  const users = [];
  const nicknames = ['Astra', 'Noctis', 'Selene', 'Orion', 'Lyra', 'Aether', 'Nova', 'Vega', 'Sirius', 'Altair'];
  const colors = ['#3498db', '#9b59b6', '#e74c3c', '#f1c40f', '#2ecc71', '#e67e22', '#1abc9c', '#e84393'];
  const countries = ['IT', 'FR', 'ES', 'DE', 'PT', 'GB', 'US', 'CA'];
  
  for (let i = 0; i < count; i++) {
    // Usa un contatore incrementale per garantire l'univocità
    const suffix = String(i + 1).padStart(4, '0');
    users.push({
      nick: `${nicknames[i % nicknames.length]}_${suffix}`,
      countryCode: countries[i % countries.length],
      avatarColor: colors[i % colors.length]
    });
  }
  return users;
}

function generateAvatarDataUrl(nick, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
    <rect width="300" height="300" fill="${color}"/>
    <circle cx="150" cy="110" r="50" fill="#ffffff" opacity="0.9"/>
    <path d="M75,250 C75,180 225,180 225,250 Z" fill="#ffffff" opacity="0.9"/>
    <text x="150" y="275" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#ffffff" text-anchor="middle">${nick}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function getSocketToken() {
  const response = await fetch(`${SERVER_URL}/api/socket-token`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Impossibile ottenere il token: ${response.status}`);
  }
  const data = await response.json();
  return data.token;
}

// ============================================================
// BOT
// ============================================================
async function startBot(userConfig, stats) {
  try {
    const token = await getSocketToken();
    const socket = io(SERVER_URL, {
      auth: { token }
    });

    stats.total++;

    socket.on('connect', () => {
      stats.connected++;
      console.log(`[BOT ${userConfig.nick}] Connesso con ID: ${socket.id}`);
      socket.emit('user_login', {
        nick: userConfig.nick,
        countryCode: userConfig.countryCode
      });
    });

    socket.on('login-success', () => {
      stats.loggedIn++;
      console.log(`[BOT ${userConfig.nick}] Login effettuato con successo.`);
      const snapshot = generateAvatarDataUrl(userConfig.nick, userConfig.avatarColor);
      socket.emit('user-snapshot', {
        imageDataUrl: snapshot,
        timestamp: Date.now()
      });
    });

    socket.on('login-error', (msg) => {
      stats.errors++;
      console.log(`[BOT ${userConfig.nick}] ❌ Login fallito: ${msg}`);
    });

    socket.on('connect_error', (err) => {
      stats.errors++;
      console.log(`[BOT ${userConfig.nick}] ❌ Connessione fallita: ${err.message}`);
    });

    socket.on('disconnect', () => {
      console.log(`[BOT ${userConfig.nick}] Disconnesso.`);
    });

    // Attendi la durata del test
    await new Promise(resolve => setTimeout(resolve, DURATION * 1000));
    
    if (socket.connected) socket.disconnect();

  } catch (err) {
    stats.errors++;
    console.error(`[BOT ${userConfig.nick}] Errore:`, err.message);
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('='.repeat(60));
  console.log(`🚀 LOAD TEST - ${USERS} utenti, ${DURATION}s`);
  console.log(`🌐 Server: ${SERVER_URL}`);
  console.log('='.repeat(60));

  // Verifica connessione
  console.log('\n🔍 Verifica connessione al server...');
  try {
    const token = await getSocketToken();
    console.log(`✅ Server risponde. Token ottenuto: ${token.substring(0, 20)}...`);
  } catch (err) {
    console.error(`❌ Server non risponde: ${err.message}`);
    process.exit(1);
  }

  const FAKE_USERS = generateFakeUsers(USERS);
  const stats = { total: 0, connected: 0, loggedIn: 0, errors: 0 };

  console.log('\n🚀 Avvio bot...\n');

  const startTime = Date.now();

  // Avvia i bot UNO ALLA VOLTA
  for (const userConfig of FAKE_USERS) {
    await startBot(userConfig, stats);
    await new Promise(r => setTimeout(r, 300));
  }

  const elapsed = (Date.now() - startTime) / 1000;

  console.log('\n' + '='.repeat(60));
  console.log(`📊 STATISTICHE LOAD TEST (${elapsed.toFixed(1)}s)`);
  console.log('='.repeat(60));
  console.log(`Totale bot tentati:   ${stats.total}`);
  console.log(`Connessi:             ${stats.connected}`);
  console.log(`Login riusciti:       ${stats.loggedIn}`);
  console.log(`Errori:               ${stats.errors}`);
  console.log('='.repeat(60));

  const successRate = stats.total > 0 ? (stats.loggedIn / stats.total) * 100 : 0;
  const errorRate = stats.total > 0 ? (stats.errors / stats.total) : 0;

  console.log(`\n📈 Tasso di successo: ${successRate.toFixed(1)}%`);
  console.log(`📈 Tasso di errori:   ${(errorRate * 100).toFixed(1)}%`);

  if (successRate > 80 && errorRate < 1) {
    console.log('\n✅ ✅ ✅ TEST PASS');
    process.exit(0);
  } else {
    console.log('\n❌ ❌ ❌ TEST FAIL');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Errore fatale:', err);
  process.exit(1);
});