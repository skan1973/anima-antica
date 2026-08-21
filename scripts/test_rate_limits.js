const io = require('socket.io-client');

// Creiamo un socket che faccia una finta autenticazione
const socket = io('http://localhost:3000', {
    auth: { token: 'mock-token' },
    transports: ['websocket']
});

async function testFloodSignal() {
  console.log("--- Test Flood Signal ---");
  // Inviamo 10 segnali velocemente. Il limite è 5.
  for(let i = 0; i < 10; i++) {
    socket.emit('signal', { roomId: 'room1', signalData: 'flood' });
    console.log(`Segnale ${i+1} inviato.`);
  }
}

async function testSpamSnapshot() {
  console.log("--- Test Spam Snapshot ---");
  socket.emit('user-snapshot', { imageDataUrl: 'data:image/png;base64,dummy', timestamp: Date.now() });
  socket.emit('user-snapshot', { imageDataUrl: 'data:image/png;base64,dummy', timestamp: Date.now() });
  console.log("Snapshot spam inviato.");
}

// Diamo tempo al socket di connettersi
socket.on('connect', () => {
    console.log("Connesso!");
    testFloodSignal();
    setTimeout(testSpamSnapshot, 1000);
});
setTimeout(() => process.exit(0), 6000);

