const socket = io({ autoConnect: false });
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const sessionLabel = document.getElementById('sessionLabel');
const endCallBtn = document.getElementById('endCallBtn');
const msgInput = document.getElementById('msgInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const messagesDiv = document.getElementById('messages');

const params = new URLSearchParams(window.location.search);
const currentNick = (params.get('nick') || '').trim();
const remoteNick = (params.get('remoteNick') || '').trim();
const roomId = (params.get('roomId') || '').trim();
const callToken = (params.get('callToken') || '').trim();
const role = (params.get('role') || '').trim();

let myPeerId = '';
let remotePeerId = '';
let localStream = null;
let peer = null;
let activePeerCall = null;
let callStarted = false;
let reconnectTimerId = null;
let reconnectAttempt = 0;
let socketConnectInFlight = false;
let authRevoked = false;
let dbOutageAlertShown = false;
let heartbeatIntervalId = null;
const HEARTBEAT_INTERVAL_MS = 30000;

if (!currentNick || !roomId || !callToken || !role) {
    alert('Parametri sessione mancanti. Torna alla lobby.');
    window.location.href = '/';
}

if (remoteNick) {
    sessionLabel.textContent = `Chat privata con ${remoteNick}`;
}

function addMessage(text, type = 'remote') {
    const item = document.createElement('div');
    item.className = `message ${type}`;
    item.textContent = text;
    messagesDiv.appendChild(item);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function getCountryCode() {
    const locale = (navigator.language || 'en-US').toUpperCase();
    const parts = locale.split('-');
    if (parts.length > 1 && /^[A-Z]{2}$/.test(parts[1])) {
        return parts[1];
    }
    return 'UN';
}

function scheduleSocketReconnect() {
    if (authRevoked || socket.connected || socketConnectInFlight || reconnectTimerId) {
        return;
    }

    const delayMs = Math.min(1000 * (2 ** Math.min(reconnectAttempt, 5)), 10000);
    reconnectAttempt += 1;
    reconnectTimerId = setTimeout(() => {
        reconnectTimerId = null;
        connectSocketAuthenticated(true);
    }, delayMs);
}

async function connectSocketAuthenticated(silent = false) {
    if (authRevoked || socket.connected || socketConnectInFlight) {
        return;
    }

    socketConnectInFlight = true;
    try {
        const response = await fetch('/api/socket-token', { method: 'GET', cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`TOKEN_HTTP_${response.status}`);
        }

        const data = await response.json();
        if (!data || typeof data.token !== 'string' || !data.token.trim()) {
            throw new Error('TOKEN_INVALID');
        }

        socket.auth = { token: data.token };
        socket.connect();
    } catch (error) {
        console.error('Errore autenticazione socket:', error);
        if (!silent) {
            alert('Connessione al server non disponibile. Riprovo automaticamente.');
        }
        scheduleSocketReconnect();
    } finally {
        socketConnectInFlight = false;
    }
}

function stopLocalMedia() {
    if (!localStream) return;
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
}

async function ensureLocalMedia() {
    if (localStream) return localStream;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('MEDIA_UNSUPPORTED');
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (error) {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    localVideo.srcObject = localStream;
    await localVideo.play().catch(() => {});
    return localStream;
}

function stopHeartbeatLoop() {
    if (!heartbeatIntervalId) return;
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
}

function sendHeartbeat() {
    if (authRevoked || !socket.connected) return;
    socket.emit('ping');
}

function startHeartbeatLoop() {
    stopHeartbeatLoop();
    sendHeartbeat();
    heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function setupPeer() {
    if (peer || !myPeerId) return;

    const peerPort = window.location.port
        ? Number.parseInt(window.location.port, 10)
        : (window.location.protocol === 'https:' ? 443 : 80);

    peer = new Peer(myPeerId, {
        host: window.location.hostname,
        port: peerPort,
        secure: window.location.protocol === 'https:',
        path: '/peerjs/myapp'
    });

    peer.on('open', () => {
        console.log('PeerJS pronto:', myPeerId);
    });

    peer.on('call', async (call) => {
        const metadata = call.metadata || {};
        const validCall = metadata.roomId === roomId && metadata.callToken === callToken;
        if (!validCall) {
            call.close();
            return;
        }

        try {
            await ensureLocalMedia();
            activePeerCall = call;
            call.answer(localStream);
            call.on('stream', (stream) => {
                remoteVideo.srcObject = stream;
                remoteVideo.play().catch(() => {});
            });
            call.on('close', () => {
                if (activePeerCall === call) activePeerCall = null;
            });
            call.on('error', () => {
                if (activePeerCall === call) activePeerCall = null;
            });
        } catch (error) {
            console.error('Errore risposta chiamata:', error);
            call.close();
        }
    });

    peer.on('error', (error) => {
        console.error('PeerJS error:', error);
    });
}

async function startCallIfNeeded() {
    if (role !== 'caller' || callStarted || !remotePeerId || !peer) {
        return;
    }

    await ensureLocalMedia();
    callStarted = true;
    const call = peer.call(remotePeerId, localStream, {
        metadata: { roomId, callToken }
    });
    if (!call) {
        callStarted = false;
        return;
    }

    activePeerCall = call;
    call.on('stream', (stream) => {
        remoteVideo.srcObject = stream;
        remoteVideo.play().catch(() => {});
    });
    call.on('close', () => {
        if (activePeerCall === call) activePeerCall = null;
    });
    call.on('error', (error) => {
        console.error('Errore chiamata peer:', error);
        if (activePeerCall === call) activePeerCall = null;
    });
}

function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    socket.emit('send-message', text);
    addMessage(text, 'self');
    msgInput.value = '';
}

socket.on('connect', () => {
    reconnectAttempt = 0;
    dbOutageAlertShown = false;
    socket.emit('user_login', {
        nick: currentNick,
        countryCode: getCountryCode()
    });
});

socket.on('login-success', async (data) => {
    myPeerId = data.peerId;
    setupPeer();
    startHeartbeatLoop();
    try {
        await ensureLocalMedia();
    } catch (error) {
        alert('Consenti webcam e microfono per iniziare la chat privata.');
    }
    socket.emit('resume-call-session', {
        roomId,
        callToken
    });
});

socket.on('resume-call-result', ({ ok, reason }) => {
    if (ok) return;
    alert(`Impossibile riprendere la sessione privata: ${reason || 'errore sconosciuto'}`);
    window.location.href = '/';
});

socket.on('private-session-ready', async ({ participants }) => {
    if (!Array.isArray(participants)) return;
    const remote = participants.find((entry) => entry.nick !== currentNick);
    if (!remote || !remote.peerId) return;

    remotePeerId = remote.peerId;
    if (!remoteNick) {
        sessionLabel.textContent = `Chat privata con ${remote.nick}`;
    }
    await startCallIfNeeded();
});

socket.on('receive-message', (message) => {
    addMessage(message, 'remote');
});

socket.on('call-ended', (message) => {
    alert(message || 'Chiamata terminata');
    window.location.href = '/';
});

socket.on('login-error', (msg) => {
    alert(msg);
    window.location.href = '/';
});

socket.on('connect_error', (error) => {
    console.error('Socket connect error:', error?.message || error);
    if (
        error?.message === 'AUTH_REQUIRED' ||
        error?.message === 'AUTH_INVALID' ||
        error?.message === 'AUTH_REVOKED' ||
        error?.message === 'AUTH_EXPIRED' ||
        error?.message === 'AUTH_CONTEXT_MISMATCH' ||
        error?.message === 'AUTH_REPLAY_DETECTED'
    ) {
        alert('Sessione non valida. Ricarica la pagina.');
        return;
    }
    if (error?.message === 'SERVICE_UNAVAILABLE') {
        if (!dbOutageAlertShown) {
            alert('Database temporaneamente non disponibile. Tentativo di riconnessione in corso.');
            dbOutageAlertShown = true;
        }
        scheduleSocketReconnect();
    }
});

socket.on('auth-revoked', () => {
    authRevoked = true;
    stopHeartbeatLoop();
    alert('Sessione revocata dal server. Ricarica la pagina.');
});

socket.on('db-unavailable', () => {
    if (!dbOutageAlertShown) {
        alert('Servizio momentaneamente degradato: riconnessione automatica appena disponibile.');
        dbOutageAlertShown = true;
    }
    scheduleSocketReconnect();
});

socket.on('disconnect', (reason) => {
    stopHeartbeatLoop();
    if (authRevoked) return;
    if (reason === 'io server disconnect') {
        scheduleSocketReconnect();
    }
});

endCallBtn.addEventListener('click', () => {
    socket.emit('end-call');
    window.location.href = '/';
});

sendMsgBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

window.addEventListener('beforeunload', () => {
    stopHeartbeatLoop();
    if (activePeerCall) activePeerCall.close();
    stopLocalMedia();
});

connectSocketAuthenticated();