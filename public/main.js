let localStream;
const camBtn = document.getElementById('camBtn');
const localVideo = document.getElementById('localVideo');
const snapshotGrid = document.getElementById('snapshotGrid');
const callPreviewGrid = document.getElementById('callPreviewGrid');
const socket = typeof io === 'function' ? io({ autoConnect: false }) : null;
let peer;
let myPeerId = '';
let currentRoomId = null;
let isPeerReady = false;
let currentNick = '';
let isCaller = false;
const loginModal = document.getElementById('loginModal');
const nickInput = document.getElementById('nickInput');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const loginCancelBtn = document.getElementById('loginCancelBtn');
const incomingCallMenu = document.getElementById('incomingCallMenu');
const incomingCallText = document.getElementById('incomingCallText');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const denyCallBtn = document.getElementById('denyCallBtn');
const blockCallBtn = document.getElementById('blockCallBtn');
let snapshotIntervalId = null;
const SNAPSHOT_INTERVAL_MS = 60000;
const snapshotCanvas = document.createElement('canvas');
let pendingCallerSocketId = null;
let pendingCallerNick = '';
let pendingTargetNick = '';
let authorizedPeerSession = null;
let activePeerCall = null;
let reconnectTimerId = null;
let reconnectAttempt = 0;
let socketConnectInFlight = false;
let authRevoked = false;
let dbOutageAlertShown = false;
let heartbeatIntervalId = null;
const HEARTBEAT_INTERVAL_MS = 30000;

if (!socket) {
    console.warn('Socket.IO non disponibile: modalità offline attiva. Effetti visivi disponibili, realtime disattivato.');
}

function scheduleSocketReconnect() {
    if (!socket || authRevoked || socket.connected || socketConnectInFlight || reconnectTimerId) {
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
    if (!socket || authRevoked || socket.connected || socketConnectInFlight) {
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

function openIncomingCallMenu(callerSocketId, callerNick) {
    pendingCallerSocketId = callerSocketId;
    pendingCallerNick = callerNick;
    incomingCallText.innerText = `${callerNick} ti sta chiamando`;
    incomingCallMenu.classList.remove('hidden');
}

function closeIncomingCallMenu() {
    incomingCallMenu.classList.add('hidden');
    pendingCallerSocketId = null;
    pendingCallerNick = '';
}

function clearPeerSession() {
    authorizedPeerSession = null;
    if (activePeerCall) {
        activePeerCall.close();
        activePeerCall = null;
    }
}

function stopHeartbeatLoop() {
    if (!heartbeatIntervalId) return;
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
}

function sendHeartbeat() {
    if (!socket || !socket.connected || authRevoked) return;
    socket.emit('ping');
}

function startHeartbeatLoop() {
    stopHeartbeatLoop();
    sendHeartbeat();
    heartbeatIntervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function openPrivateChatPage({ roomId, callToken, role, nick, remoteNick }) {
    const params = new URLSearchParams({
        roomId,
        callToken,
        role,
        nick,
        remoteNick: remoteNick || ''
    });
    window.location.href = `/chat.html?${params.toString()}`;
}

function getCountryCode() {
    const locale = (navigator.language || 'en-US').toUpperCase();
    const parts = locale.split('-');
    if (parts.length > 1 && /^[A-Z]{2}$/.test(parts[1])) {
        return parts[1];
    }
    return 'UN';
}

function toFlagEmoji(countryCode) {
    const code = String(countryCode || 'UN').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
    const base = 127397;
    return String.fromCodePoint(code.charCodeAt(0) + base, code.charCodeAt(1) + base);
}

function createSnapshotCard(user) {
    const card = document.createElement('article');
    card.className = 'snapshot-card';

    const imageWrap = document.createElement('div');
    imageWrap.className = 'snapshot-image-wrap';

    if (user.snapshot) {
        const img = document.createElement('img');
        img.className = 'snapshot-image';
        img.src = user.snapshot;
        img.alt = `Snapshot di ${user.nick}`;
        imageWrap.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'snapshot-placeholder';
        placeholder.innerText = 'In attesa di snapshot';
        imageWrap.appendChild(placeholder);
    }

    const meta = document.createElement('div');
    meta.className = 'snapshot-meta';

    const nick = document.createElement('strong');
    nick.innerText = user.nick;

    if (user.nick !== currentNick) {
        nick.className = 'clickable-nick';
        nick.title = `Chiama ${user.nick}`;
        nick.addEventListener('click', () => {
            isCaller = true;
            pendingTargetNick = user.nick;
            socket?.emit('call-request', { targetNick: user.nick });
        });
    }

    const right = document.createElement('div');
    right.className = 'snapshot-right';

    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.title = user.countryCode || 'UN';
    flag.innerText = toFlagEmoji(user.countryCode);

    right.appendChild(flag);
    meta.appendChild(nick);
    meta.appendChild(right);

    card.appendChild(imageWrap);
    card.appendChild(meta);

    return card;
}

function renderUsers(users) {
    snapshotGrid.innerHTML = '';

    users.forEach((user) => {
        snapshotGrid.appendChild(createSnapshotCard(user));
    });
}

function renderOfflineFakeUsers() {
    const fakeUsers = [
        { nick: 'Astra', countryCode: 'IT', snapshot: null },
        { nick: 'Noctis', countryCode: 'FR', snapshot: null },
        { nick: 'Selene', countryCode: 'ES', snapshot: null },
        { nick: 'Orion', countryCode: 'DE', snapshot: null },
        { nick: 'Lyra', countryCode: 'PT', snapshot: null },
        { nick: 'Aether', countryCode: 'SE', snapshot: null }
    ];
    renderUsers(fakeUsers);
}

function stopSnapshotLoop() {
    if (snapshotIntervalId) {
        clearInterval(snapshotIntervalId);
        snapshotIntervalId = null;
    }
}

function sendSnapshot() {
    if (!localStream || !currentNick || !socket?.connected) return;
    if (!localVideo.videoWidth || !localVideo.videoHeight) return;

    snapshotCanvas.width = localVideo.videoWidth;
    snapshotCanvas.height = localVideo.videoHeight;
    const ctx = snapshotCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(localVideo, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
    const imageDataUrl = snapshotCanvas.toDataURL('image/jpeg', 0.75);
    socket?.emit('user-snapshot', {
        imageDataUrl,
        timestamp: Date.now()
    });
}

function startSnapshotLoop() {
    stopSnapshotLoop();
    sendSnapshot();
    snapshotIntervalId = setInterval(sendSnapshot, SNAPSHOT_INTERVAL_MS);
}

function openLoginModal() {
    loginModal.classList.remove('hidden');
    nickInput.focus();
}

function closeLoginModal() {
    loginModal.classList.add('hidden');
    nickInput.value = '';
}

function submitLogin() {
    const nick = nickInput.value.trim();
    if (!nick) return;

    currentNick = nick;
    socket?.emit('user_login', {
        nick: currentNick,
        countryCode: getCountryCode()
    });
    closeLoginModal();
}

function addVideoStream(video, stream) {
    video.srcObject = stream;
    if (video !== localVideo && !video.parentElement) {
        callPreviewGrid.append(video);
    }
    video.addEventListener('loadedmetadata', () => {
        video.play();
    });
}

function setupPeer() {
    const peerPort = window.location.port
        ? Number.parseInt(window.location.port, 10)
        : (window.location.protocol === 'https:' ? 443 : 80);

    peer = new Peer(myPeerId, {
        host: window.location.hostname,
        port: peerPort,
        secure: window.location.protocol === 'https:',
        path: '/peerjs/myapp'
    });

    peer.on('open', (id) => {
        isPeerReady = true;
        console.log('PeerJS pronto con ID:', id);
    });

    peer.on('call', (call) => {
        const metadata = call.metadata || {};
        const isAuthorizedIncomingCall =
            authorizedPeerSession &&
            metadata.roomId === authorizedPeerSession.roomId &&
            metadata.callToken === authorizedPeerSession.callToken &&
            call.peer === authorizedPeerSession.remotePeerId;

        if (!isAuthorizedIncomingCall) {
            console.warn('Peer call rifiutata: sessione non autorizzata', {
                fromPeer: call.peer,
                roomId: metadata.roomId
            });
            call.close();
            return;
        }

        if (!localStream) {
            console.warn('Nessun stream locale disponibile per rispondere alla chiamata.');
            call.close();
            return;
        }

        activePeerCall = call;
        call.answer(localStream);
        const video = document.createElement('video');
        call.on('stream', userVideoStream => {
            addVideoStream(video, userVideoStream);
        });
        call.on('close', () => {
            if (activePeerCall === call) {
                activePeerCall = null;
            }
        });
        call.on('error', () => {
            if (activePeerCall === call) {
                activePeerCall = null;
            }
        });
    });

    peer.on('error', (err) => {
        console.error('PeerJS error:', err);
    });
}

socket?.on('login-success', (data) => {
    myPeerId = data.peerId;
    console.log('Logged in with PeerID:', myPeerId);
    setupPeer();
    startHeartbeatLoop();
});

socket?.on('login-error', (message) => {
    alert(message);
});

socket?.on('connect', () => {
    reconnectAttempt = 0;
    dbOutageAlertShown = false;
});

socket?.on('connect_error', (error) => {
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

socket?.on('call-feedback', (msg) => {
    alert(msg);
});

socket?.on('auth-revoked', () => {
    authRevoked = true;
    stopHeartbeatLoop();
    alert('Sessione revocata dal server. Ricarica la pagina.');
});

socket?.on('db-unavailable', () => {
    if (!dbOutageAlertShown) {
        alert('Servizio momentaneamente degradato: riconnessione automatica appena disponibile.');
        dbOutageAlertShown = true;
    }
    scheduleSocketReconnect();
});

socket?.on('disconnect', (reason) => {
    stopHeartbeatLoop();
    if (authRevoked) return;
    if (reason === 'io server disconnect') {
        scheduleSocketReconnect();
    }
});

socket?.on('call-ended', (message) => {
    alert(message);
    currentRoomId = null;
    isCaller = false;
    pendingTargetNick = '';
    clearPeerSession();
    closeIncomingCallMenu();
    console.log('Chiamata terminata dal server');
});

socket?.on('incoming-call', ({ callerSocketId, callerNick }) => {
    openIncomingCallMenu(callerSocketId, callerNick);
});

socket?.on('call-accepted', ({ receiverPeerId, roomId, callToken }) => {
    if (!receiverPeerId || !roomId || !callToken) {
        alert('Sessione chiamata non valida.');
        return;
    }

    currentRoomId = roomId;
    authorizedPeerSession = {
        roomId,
        callToken,
        remotePeerId: receiverPeerId
    };
    closeIncomingCallMenu();
    console.log('Stanza creata, chiamando peer:', receiverPeerId);

    const role = isCaller ? 'caller' : 'callee';
    const remoteNick = isCaller ? pendingTargetNick : pendingCallerNick;
    openPrivateChatPage({
        roomId,
        callToken,
        role,
        nick: currentNick,
        remoteNick
    });
});

socket?.on('update_user_list', (users) => {
    if (!Array.isArray(users)) return;
    const normalized = users.map((entry) => {
        if (typeof entry === 'string') {
            return { nick: entry, countryCode: 'UN', snapshot: null };
        }
        return {
            nick: entry.nick,
            countryCode: entry.countryCode || 'UN',
            snapshot: entry.snapshot || null
        };
    }).filter(user => user.nick);

    renderUsers(normalized);
});

function startCall(targetPeerId, roomId, callToken) {
    if (!isPeerReady) {
        alert('PeerJS non ancora connesso, attendi un istante...');
        return;
    }
    if (!localStream) {
        alert('Attiva la webcam prima di chiamare.');
        return;
    }
    if (!roomId || !callToken) {
        alert('Sessione chiamata non autorizzata.');
        return;
    }

    const call = peer.call(targetPeerId, localStream, {
        metadata: {
            roomId,
            callToken
        }
    });
    if (!call) {
        console.error('Errore: Impossibile creare la chiamata.');
        return;
    }

    activePeerCall = call;
    const video = document.createElement('video');
    call.on('stream', userVideoStream => {
        addVideoStream(video, userVideoStream);
    });
    call.on('error', (err) => {
        console.error('Errore chiamata:', err);
        if (activePeerCall === call) {
            activePeerCall = null;
        }
    });
    call.on('close', () => {
        if (activePeerCall === call) {
            activePeerCall = null;
        }
    });
}

function endCall() {
    if (currentRoomId) {
        socket?.emit('end-call');
        currentRoomId = null;
        isCaller = false;
        clearPeerSession();
        console.log('Chiamata terminata dal client');
    }
}

async function getDeviceSummary() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return null;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(device => device.kind === 'videoinput').length;
    const audioInputs = devices.filter(device => device.kind === 'audioinput').length;

    return { videoInputs, audioInputs };
}

window.addEventListener('beforeunload', () => {
    stopHeartbeatLoop();
    stopSnapshotLoop();
    endCall();
});

camBtn.addEventListener('click', async () => {
    if (!localStream) {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert('Il browser non supporta getUserMedia per webcam/microfono.');
                return;
            }

            const deviceSummary = await getDeviceSummary();
            if (deviceSummary && deviceSummary.videoInputs === 0) {
                alert('Nessuna webcam rilevata sul sistema. Collega una webcam e riprova.');
                return;
            }

            try {
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
            } catch (firstErr) {
                console.warn('Tentativo webcam+microfono fallito, provo solo webcam:', firstErr);
                if (deviceSummary && deviceSummary.audioInputs === 0) {
                    console.warn('Nessun microfono rilevato: continuo solo con video.');
                }
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });
            }

            addVideoStream(localVideo, localStream);
            camBtn.innerText = 'Webcam Off';
            startSnapshotLoop();
        } catch (err) {
            console.error('Errore accesso webcam:', err);
            if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
                alert('Permesso webcam/microfono negato. Consenti l\'accesso in Firefox.');
                return;
            }
            if (err && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
                alert('Nessuna webcam disponibile o rilevata dal sistema.');
                return;
            }
            alert('Impossibile accedere alla webcam. Verifica dispositivi e permessi del browser.');
        }
    } else {
        localStream.getTracks().forEach(track => track.stop());
        stopSnapshotLoop();
        localStream = null;
        localVideo.srcObject = null;
        camBtn.innerText = 'Webcam On';
    }
});

document.getElementById('authBtn').onclick = () => {
    openLoginModal();
};

// Logica particelle mouse
document.addEventListener('mousemove', (e) => {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = `${e.clientX}px`;
    particle.style.top = `${e.clientY}px`;
    const size = Math.random() * 15 + 5;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 800);
});

// Generazione stelle
const starsContainer = document.getElementById('starsContainer');
function createStars() {
    for (let i = 0; i < 100; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.width = `${Math.random() * 3}px`;
        star.style.height = star.style.width;
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        star.style.animationDelay = `${Math.random() * 3}s`;
        starsContainer.appendChild(star);
    }
}
function createShootingStar() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const randomEdgePoint = () => {
        const edge = Math.floor(Math.random() * 4);
        if (edge === 0) return { x: Math.random() * vw, y: -40 }; // top
        if (edge === 1) return { x: vw + 40, y: Math.random() * vh }; // right
        if (edge === 2) return { x: Math.random() * vw, y: vh + 40 }; // bottom
        return { x: -40, y: Math.random() * vh }; // left
    };

    let start = randomEdgePoint();
    let end = randomEdgePoint();

    // Ensure meaningful trajectory length and avoid almost-static diagonals.
    let attempts = 0;
    while (Math.hypot(end.x - start.x, end.y - start.y) < Math.min(vw, vh) * 0.6 && attempts < 8) {
        end = randomEdgePoint();
        attempts += 1;
    }

    const angleDeg = Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
    const durationSec = (1.8 + Math.random() * 3.8).toFixed(2);
    const starLengthPx = Math.floor(70 + Math.random() * 120);

    const star = document.createElement('div');
    star.className = 'shooting-star';
    star.style.setProperty('--sx', `${start.x}px`);
    star.style.setProperty('--sy', `${start.y}px`);
    star.style.setProperty('--ex', `${end.x}px`);
    star.style.setProperty('--ey', `${end.y}px`);
    star.style.setProperty('--rot', `${angleDeg}deg`);
    star.style.setProperty('--dur', `${durationSec}s`);
    star.style.setProperty('--star-len', `${starLengthPx}px`);
    starsContainer.appendChild(star);
    setTimeout(() => star.remove(), Number(durationSec) * 1000 + 200);
}
createStars();
setInterval(createShootingStar, 3500);

loginSubmitBtn.addEventListener('click', submitLogin);
loginCancelBtn.addEventListener('click', closeLoginModal);
nickInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        submitLogin();
    }
    if (event.key === 'Escape') {
        closeLoginModal();
    }
});

acceptCallBtn.addEventListener('click', () => {
    if (!pendingCallerSocketId) return;
    isCaller = false;
    socket?.emit('accept-call', { callerSocketId: pendingCallerSocketId });
    closeIncomingCallMenu();
});

denyCallBtn.addEventListener('click', () => {
    if (!pendingCallerSocketId) return;
    socket?.emit('deny-call', { callerSocketId: pendingCallerSocketId });
    closeIncomingCallMenu();
});

blockCallBtn.addEventListener('click', () => {
    if (!pendingCallerSocketId) return;
    socket?.emit('block-caller', { callerSocketId: pendingCallerSocketId });
    closeIncomingCallMenu();
});

connectSocketAuthenticated();

if (!socket) {
    renderOfflineFakeUsers();
}

