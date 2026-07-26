const logDiv = document.getElementById('log');
const testLoginBtn = document.getElementById('testLoginBtn');
const testInvalidMessageBtn = document.getElementById('testInvalidMessageBtn');
const testBanBtn = document.getElementById('testBanBtn');

let socket;

function log(msg, className = '') {
    const row = document.createElement('div');
    if (className) row.className = className;
    row.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
    logDiv.appendChild(row);
    logDiv.scrollTop = logDiv.scrollHeight;
}

async function connectSocketAuthenticated() {
    try {
        const response = await fetch('/api/socket-token', { method: 'GET', cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`TOKEN_HTTP_${response.status}`);
        }

        const data = await response.json();
        if (!data || typeof data.token !== 'string' || !data.token.trim()) {
            throw new Error('TOKEN_INVALID');
        }

        socket = io({
            autoConnect: false,
            auth: { token: data.token }
        });

        socket.on('connect', () => log('Connesso al server!', 'success'));
        socket.on('login-error', (err) => log(`ERRORE LOGIN: ${err}`, 'error'));
        socket.on('call-feedback', (msg) => log(`FEEDBACK: ${msg}`));
        socket.on('disconnect', () => log('DISCONNESSO DAL SERVER (Possibile Ban)', 'error'));
        socket.on('connect_error', (error) => log(`ERRORE CONNESSIONE: ${error?.message || error}`, 'error'));

        socket.connect();
    } catch (error) {
        log(`Impossibile autenticare socket: ${error?.message || error}`, 'error');
    }
}

function testLogin() {
    if (!socket || !socket.connected) {
        log('Socket non connessa.', 'error');
        return;
    }
    socket.emit('user_login', 'SkanTest');
    log('Login inviato...');
}

function testInvalidMessage() {
    if (!socket || !socket.connected) {
        log('Socket non connessa.', 'error');
        return;
    }
    // Inviamo dati che violano lo schema Zod (tipo payload errato).
    socket.emit('send-message', { text: 'Messaggio senza schema valido', timestamp: Date.now() });
    log('Inviato messaggio non valido (Zod dovrebbe bloccarlo).');
}

function testBan() {
    if (!socket || !socket.connected) {
        log('Socket non connessa.', 'error');
        return;
    }
    socket.emit('call-request', { targetNick: 'NON_ESISTENTE' });
    log('Inviata richiesta chiamata...');
}

testLoginBtn.addEventListener('click', testLogin);
testInvalidMessageBtn.addEventListener('click', testInvalidMessage);
testBanBtn.addEventListener('click', testBan);

connectSocketAuthenticated();
