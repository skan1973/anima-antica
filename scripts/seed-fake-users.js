// scripts/seed-fake-users.js
const { io } = require('socket.io-client');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const FAKE_USERS = [
  { nick: 'Astra_IT', countryCode: 'IT', avatarColor: '#3498db' },
  { nick: 'Noctis_FR', countryCode: 'FR', avatarColor: '#9b59b6' },
  { nick: 'Selene_ES', countryCode: 'ES', avatarColor: '#e74c3c' },
  { nick: 'Orion_DE', countryCode: 'DE', avatarColor: '#f1c40f' },
  { nick: 'Lyra_PT', countryCode: 'PT', avatarColor: '#2ecc71' }
];

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

async function startBot(userConfig) {
  try {
    const token = await getSocketToken();
    const socket = io(SERVER_URL, {
      auth: { token }
    });

    let currentRoomId = null;

    socket.on('connect', () => {
      console.log(`[BOT ${userConfig.nick}] Connesso con ID: ${socket.id}`);
      socket.emit('user_login', {
        nick: userConfig.nick,
        countryCode: userConfig.countryCode
      });
    });

    socket.on('login-success', () => {
      console.log(`[BOT ${userConfig.nick}] Login effettuato con successo.`);
      const snapshot = generateAvatarDataUrl(userConfig.nick, userConfig.avatarColor);
      socket.emit('user-snapshot', {
        imageDataUrl: snapshot,
        timestamp: Date.now()
      });
    });

    socket.on('incoming-call', (data) => {
      console.log(`[BOT ${userConfig.nick}] Ricevuta chiamata da: ${data.callerNick}`);
      setTimeout(() => {
        console.log(`[BOT ${userConfig.nick}] Accettazione chiamata da: ${data.callerNick}`);
        socket.emit('accept-call', { callerSocketId: data.callerSocketId });
      }, 1500);
    });

    socket.on('call-accepted', (data) => {
      currentRoomId = data.roomId;
      console.log(`[BOT ${userConfig.nick}] Chiamata avviata nella stanza: ${currentRoomId}`);
      
      setTimeout(() => {
        socket.emit('send-message', `Ciao! Sono ${userConfig.nick}. Benvenuto su ANIMA ANTICA! 🏛️✨`);
      }, 2000);
    });

    socket.on('receive-message', (msg) => {
      console.log(`[BOT ${userConfig.nick}] Messaggio ricevuto: "${msg}"`);
      setTimeout(() => {
        socket.emit('send-message', `Ho ricevuto il tuo messaggio: "${msg}". Tutto funziona alla perfezione! 👍`);
      }, 1200);
    });

    socket.on('call-ended', () => {
      console.log(`[BOT ${userConfig.nick}] Chiamata terminata.`);
      currentRoomId = null;
    });

    socket.on('disconnect', () => {
      console.log(`[BOT ${userConfig.nick}] Disconnesso dal server.`);
    });
  } catch (err) {
    console.error(`[BOT ${userConfig.nick}] Errore:`, err.message);
  }
}

async function main() {
  console.log('Avvio bot utenti fittizi per ANIMA ANTICA...');
  for (const userConfig of FAKE_USERS) {
    await startBot(userConfig);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('Tutti gli utenti fittizi sono ora ONLINE su http://localhost:3000/');
}

main();
