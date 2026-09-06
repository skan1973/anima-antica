const socket = io({ autoConnect: false });
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const sessionLabel = document.getElementById('sessionLabel');
const endCallBtn = document.getElementById('endCallBtn');
const msgInput = document.getElementById('msgInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const messagesDiv = document.getElementById('messages');

const params = new URLSearchParams(window.location.search);
const sessionKey = params.get('session') || '';
let sessionData = null;
try {
    sessionData = sessionKey ? JSON.parse(sessionStorage.getItem(sessionKey) || 'null') : null;
} catch (error) {
    sessionData = null;
}
if (sessionKey) sessionStorage.removeItem(sessionKey);
window.history.replaceState({}, document.title, '/chat.html');

const currentNick = (sessionData?.nick || '').trim();
const remoteNick = (sessionData?.remoteNick || '').trim();
const roomId = (sessionData?.roomId || '').trim();
const callToken = (sessionData?.callToken || '').trim();
const role = (sessionData?.role || '').trim();

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
let heartbeatTimeoutId = null;
let lastHeartbeatAt = 0;

let turnConfig = null; // Variabile per memorizzare la configurazione TURN + WebRTC

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

    const baseDelayMs = Math.min(1000 * (2 ** Math.min(reconnectAttempt, 5)), 10000);
    const delayMs = Math.round(baseDelayMs * (0.75 + Math.random() * 0.5));
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
    if (heartbeatTimeoutId) clearTimeout(heartbeatTimeoutId);
    heartbeatTimeoutId = null;
}

function sendHeartbeat() {
    if (authRevoked || !socket.connected) return;
    lastHeartbeatAt = Date.now();
    socket.emit('ping');
    if (heartbeatTimeoutId) clearTimeout(heartbeatTimeoutId);
    heartbeatTimeoutId = setTimeout(() => {
        if (socket.connected && Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
            socket.disconnect();
            scheduleSocketReconnect();
        }
    }, HEARTBEAT_INTERVAL_MS * 2);
}

function startHeartbeatLoop() {
    stopHeartbeatLoop();
    sendHeartbeat();
    heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// ============================================================
// TURN + WEBRTC CONFIGURATION (Punto 12 + Punto 13)
// ============================================================
async function fetchTurnConfig() {
    try {
        const response = await fetch('/api/turn-config');
        if (!response.ok) {
            console.warn('Impossibile ottenere configurazione TURN/WebRTC:', response.status);
            return null;
        }
        const data = await response.json();
        console.log('Configurazione ricevuta:', data);
        return data;
    } catch (error) {
        console.error('Errore durante il fetch della configurazione:', error);
        return null;
    }
}

// ============================================================
// BITRATE CONTROL (Punto 13)
// ============================================================
function applyBitrateConstraints(peerConnection, config) {
    if (!peerConnection || !config) return;

    try {
        const senders = peerConnection.getSenders();
        senders.forEach((sender) => {
            if (!sender.track) return;
            const kind = sender.track.kind;

            if (kind === 'video' && config.maxBitrateKbps) {
                const params = sender.getParameters();
                if (!params.encodings) params.encodings = [{}];
                params.encodings[0].maxBitrate = config.maxBitrateKbps * 1000;
                sender.setParameters(params).catch((e) => {
                    console.warn('Impossibile impostare maxBitrate video:', e);
                });
                console.log(`Bitrate video impostato a ${config.maxBitrateKbps} kbps`);
            }

            if (kind === 'audio' && config.audioBitrateKbps) {
                const params = sender.getParameters();
                if (!params.encodings) params.encodings = [{}];
                params.encodings[0].maxBitrate = config.audioBitrateKbps * 1000;
                sender.setParameters(params).catch((e) => {
                    console.warn('Impossibile impostare maxBitrate audio:', e);
                });
                console.log(`Bitrate audio impostato a ${config.audioBitrateKbps} kbps`);
            }
        });
    } catch (error) {
        console.warn('Errore durante l\'applicazione del bitrate:', error);
    }
}

function setupPeer() {
    if (peer || !myPeerId) return;

    const peerPort = window.location.port
        ? Number.parseInt(window.location.port, 10)
        : (window.location.protocol === 'https:' ? 443 : 80);

    const peerOptions = {
        host: window.location.hostname,
        port: peerPort,
        secure: window.location.protocol === 'https:',
        path: '/peerjs/myapp'
    };

    // Applica configurazione TURN + WebRTC se disponibile
    if (turnConfig) {
        const config = {};

        // TURN / STUN servers
        if (turnConfig.iceServers && turnConfig.iceServers.length > 0) {
            config.iceServers = turnConfig.iceServers;
            console.log('TURN servers configurati:', turnConfig.iceServers.length);
        }

        // WebRTC Tuning (Punto 13)
        if (turnConfig.webRtcConfig) {
            const w = turnConfig.webRtcConfig;
            if (w.iceCandidatePoolSize) config.iceCandidatePoolSize = w.iceCandidatePoolSize;
            if (w.iceTransportPolicy) config.iceTransportPolicy = w.iceTransportPolicy;
            if (w.bundlePolicy) config.bundlePolicy = w.bundlePolicy;
            if (w.rtcpMuxPolicy) config.rtcpMuxPolicy = w.rtcpMuxPolicy;
            console.log('WebRTC tuning applicato:', w);
        }

        if (Object.keys(config).length > 0) {
            peerOptions.config = config;
        }
    } else {
        console.log('Nessuna configurazione TURN/WebRTC ricevuta, uso default');
    }

    peer = new Peer(myPeerId, peerOptions);

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
                remoteVideo.play().catch((error) => console.warn('Riproduzione video remoto bloccata:', error));
            });
            call.on('close', () => {
                if (activePeerCall === call) activePeerCall = null;
            });
            call.on('error', () => {
                if (activePeerCall === call) activePeerCall = null;
            });

            // Applica bitrate constraints sulla peer connection
            const pc = call.peerConnection;
            if (pc && turnConfig?.webRtcConfig) {
                applyBitrateConstraints(pc, turnConfig.webRtcConfig);
            }
        } catch (error) {
            console.error('Errore risposta chiamata:', error);
            call.close();
        }
    });

    peer.on('error', (error) => {
        console.error('PeerJS error:', error);
        destroyPeerSession();
    });
}

function destroyPeerSession() {
    if (activePeerCall) {
        activePeerCall.close();
        activePeerCall = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }
    stopLocalMedia();
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
        remoteVideo.play().catch((error) => console.warn('Riproduzione video remoto bloccata:', error));
    });
    call.on('close', () => {
        if (activePeerCall === call) activePeerCall = null;
    });
    call.on('error', (error) => {
        console.error('Errore chiamata peer:', error);
        if (activePeerCall === call) activePeerCall = null;
    });

    // Applica bitrate constraints sulla peer connection
    const pc = call.peerConnection;
    if (pc && turnConfig?.webRtcConfig) {
        applyBitrateConstraints(pc, turnConfig.webRtcConfig);
    }
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
    console.log('Logged in with PeerID:', myPeerId);

    // Prima di configurare Peer, otteniamo la configurazione TURN + WebRTC
    fetchTurnConfig().then((config) => {
        turnConfig = config;
        setupPeer();
    }).catch((err) => {
        console.warn('Errore durante il fetch del TURN/WebRTC, continuo senza:', err);
        setupPeer();
    });

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
    destroyPeerSession();
    if (authRevoked) return;
    if (reason === 'io server disconnect') {
        scheduleSocketReconnect();
    }
});

endCallBtn.addEventListener('click', () => {
    socket.emit('end-call');
    destroyPeerSession();
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
    destroyPeerSession();
});

connectSocketAuthenticated();