# ANIMA ANTICA - Passi finali per la produzione

## 0. Scopo e conclusione dell'audit

Questo documento descrive, in ordine operativo, cosa resta da fare per pubblicare ANIMA ANTICA online con un budget minimo senza saltare i controlli essenziali.

Audit eseguito sul repository alla data del 2026-09-06.

### Stato attuale in breve

- Backend: Node.js 20, Express, Socket.IO, PeerJS, MongoDB/Mongoose, Redis opzionale.
- Frontend: file statici in `public/` (`index.html`, `chat.html`, `main.js`, `chat.js`).
- Deploy predisposto solo parzialmente: esistono Dockerfile, configurazione PM2 e esempio Nginx, ma manca una procedura completa e verificata.
- TLS, dominio, MongoDB, Redis e TURN non sono configurati nel repository.
- Il codice contiene già autenticazione JWT, rate limiting, Helmet, validazione parziale, logging JSON e gestione dello stato.
- Il commit più recente contiene hardening, test e documentazione, ma non equivale a una certificazione di produzione.

### Aggiornamento dopo le priorità immediate

- ✅ Il frontend statico viene servito da Express.
- ✅ Le route `/api/health/token-registry` e `/api/metrics` rispondono correttamente in smoke test locale.
- ✅ `npm run test:unit` ora usa `tests/*.test.js`: 24 test, 23 passati e 1 skipped senza Redis.
- ✅ I timer globali di cleanup/watchdog non bloccano più la suite.
- ✅ Il frontend non mette più `callToken` nella query string: usa una chiave temporanea in `sessionStorage` e pulisce l'URL.
- ✅ Cleanup PeerJS/media stream, jitter di riconnessione e timeout heartbeat aggiunti.
- ✅ Shutdown coordinato di HTTP, Socket.IO, MongoDB, Redis e timer aggiunto.
- ✅ Docker healthcheck e hardening Nginx per HTTPS/WebSocket aggiunti.
- ✅ `signalData` non accetta più payload arbitrari: sono stati aggiunti schemi SDP, ICE e controllo.
- ✅ `BCRYPT_ROUNDS` è limitato all'intervallo 10-14, con default 12.
- ✅ È presente `server/.env.example` senza segreti reali.
- ✅ In produzione `/api/metrics` richiede `METRICS_TOKEN`; senza token configurato risponde `404`.
- ⚠️ Il test unitario lascia ancora il processo aperto perché importa l'avvio del server; il processo va ancora isolato per avere una suite CI pulita.
- ⚠️ Restano da verificare l'audit npm dopo l'override di `qs` e gli aspetti infrastrutturali prima del go-live.

### Decisione consigliata per il budget minimo

Per il primo rilascio usare **una sola VPS Linux economica** e una sola istanza Node:

1. VPS da circa 1-2 GB RAM con IPv4 pubblico.
2. Nginx sulla VPS per HTTPS e reverse proxy.
3. Node.js/PM2 oppure Docker per l'applicazione.
4. MongoDB Atlas Free Tier, se disponibile e adeguato al traffico.
5. Redis locale sulla VPS, vincolato a localhost e con password/ACL, solo per una singola istanza.
6. Coturn sulla VPS oppure un servizio TURN con piano gratuito/low-cost.
7. Let's Encrypt per il certificato TLS.
8. Backup MongoDB giornaliero su storage esterno o su una seconda destinazione.

Non usare il cluster a tre istanze finché Redis condiviso, sessioni, rate limit distribuiti e invalidazione Socket.IO non sono stati collaudati in modo dedicato.

---

## 1. Blocchi obbligatori prima del deploy

Questi punti devono essere risolti prima di pubblicare il dominio. Non procedere al passo successivo se uno di essi fallisce.

### 1.1 Servire davvero il frontend

Il problema è stato corretto: `server/server.js` monta `express.static` sulla directory `public/`. Nginx inoltra tutto a Node, quindi verificare che il server continui a servire:

- `/` -> `public/index.html`;
- `/chat.html`;
- `/main.js`, `/chat.js`, CSS e altre risorse;
- `/socket.io/` e `/peerjs/` tramite proxy WebSocket/HTTP.

La correzione è stata applicata. Da verificare prima del deploy:

```js
const path = require('node:path');

app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html',
  extensions: ['html']
}));
```

Verificare anche che non vengano serviti file `.env`, documenti interni o directory del progetto.

### 1.2 Correggere e testare gli endpoint di health e metriche

In `server/server.js` sono presenti e verificate le route:

- `/api/health/token-registry`;
- `/api/metrics`.

Le funzioni `getHealthStatus()` e `getMetrics()` sono ora importate dai moduli proprietari. Prima della pubblicazione bisogna:

1. eseguire richieste HTTP a entrambe le route dopo ogni deploy;
2. verificare che una route rotta non faccia fallire il monitoraggio;
3. proteggere `/api/metrics` con `METRICS_TOKEN` o allowlist di rete.

Comando minimo dopo la correzione:

```powershell
node --check server/server.js
curl.exe -i http://127.0.0.1:3000/api/health
curl.exe -i http://127.0.0.1:3000/api/health/token-registry
curl.exe -i http://127.0.0.1:3000/api/metrics
```

### 1.3 Sistemare la suite di test

Lo script in `package.json` è stato corretto ed è:

```text
node --test tests/*.test.js
```

Prima della correzione il comando puntava a `test/` e poteva terminare con `0 test`, dando una falsa sensazione di copertura.

Prima del deploy:

1. fare in modo che i test non lascino il server aperto dopo l'esecuzione;
2. aggiungere uno script dedicato per i test E2E se richiesto;
3. verificare che il comando fallisca se un test fallisce;
4. eseguire nuovamente l'intera suite e registrare il numero di test passati.

Comando di verifica attuale:

```powershell
node --test tests/*.test.js
```

### 1.4 Risolvere le vulnerabilità delle dipendenze

L'audit iniziale eseguito con:

```powershell
npm audit --omit=dev --audit-level=high
```

ha segnalato 15 vulnerabilità, tra cui vulnerabilità alte in `socket.io-parser` e `ws`, e una vulnerabilità critica transitiva in `tar` proveniente dalla catena di `bcrypt`.

Aggiornamento locale: `bcrypt` è stato sostituito con `bcryptjs`, gli override di Socket.IO/Engine.IO/WS sono stati aggiornati e `qs` è stato portato a `6.16.0`. L'ultimo controllo locale restituisce 0 vulnerabilità.

Procedura prudente:

1. salvare il report completo:

   ```powershell
   npm audit --json > audit-report.json
   ```

2. controllare quali fix sono compatibili con Node 20 e con l'app;
3. eseguire prima `npm audit fix` in un branch o copia di lavoro;
4. non eseguire automaticamente `npm audit fix --force`, perché può cambiare major version e installare `bcrypt@6`;
5. rieseguire test, smoke test Socket.IO e test WebRTC dopo ogni aggiornamento;
6. verificare `npm ci` da zero usando solo `package-lock.json`.

Il deploy deve essere bloccato se resta una vulnerabilità critica raggiungibile in produzione senza una decisione documentata e una mitigazione concreta.

### 1.5 Verificare il comportamento Redis in ogni modalità

Il progetto può funzionare senza Redis in modalità memoria, ma questa modalità non offre:

- persistenza dei token;
- condivisione dello stato tra istanze;
- rate limiting distribuito;
- presenza condivisa;
- invalidazione cross-instance affidabile.

Per il primo deploy a istanza singola è accettabile usare Redis locale per evitare il degrado. In produzione:

1. installare Redis sulla VPS oppure usare un Redis gestito;
2. non esporre la porta Redis su Internet;
3. usare autenticazione ACL/password e, se Redis è remoto, TLS;
4. verificare che `REDIS_URL` venga letto all'avvio;
5. testare riavvio Redis e perdita temporanea della connessione;
6. verificare che il rate limit non torni silenziosamente a una modalità insicura in un cluster.

Nota tecnica: `redis.js` esporta `pubClient` come valore iniziale. Se il client viene assegnato dopo il caricamento del modulo, i consumer che fanno destructuring possono conservare `undefined`. Va verificato con un test reale che il client usato da `server.js` e dai servizi sia quello connesso, non una copia iniziale.

---

## 2. Correzioni di sicurezza applicativa

### 2.1 Segnali WebRTC: sostituire `z.any()`

In `server/schemas/socketEventsSchema.js`, `signalData` è ancora definito come `z.any()`. È una superficie di input non controllata per eventi Socket.IO.

Implementare uno schema limitato, ad esempio con varianti esplicite per:

- offer;
- answer;
- ICE candidate;
- renegotiate;
- end/hangup.

Imporre lunghezze massime su SDP, candidate, `roomId` e campi metadata. Rifiutare campi sconosciuti dove possibile. Aggiungere test per payload giganteschi, oggetti annidati, tipi errati e campi extra.

### 2.2 Non mettere token JWT nella query string

`public/main.js` trasferisce `callToken`, `roomId`, `nick` e ruolo nella query string di `chat.html`. Questo può esporre token in:

- cronologia browser;
- log Nginx;
- log di proxy e CDN;
- header `Referer`;
- screenshot o link copiati.

La correzione locale è stata applicata: il frontend usa una chiave temporanea in `sessionStorage`, rimuove il parametro dalla barra degli indirizzi e cancella il record dopo la lettura. Per una protezione ancora più forte resta da valutare un handshake server-side con cookie `HttpOnly`, `Secure`, `SameSite=Strict`.

Per una correzione progressiva a basso costo:

1. mantenere l'identificatore breve e monouso non sensibile nell'URL;
2. mantenere la scadenza e la pulizia di `sessionStorage`;
3. impedire il caricamento di risorse di terze parti nella pagina chat;
4. non loggare query string complete;
5. valutare in seguito un handshake server-side con cookie `HttpOnly`, `Secure`, `SameSite=Strict`.

Non considerare `sessionStorage` una sostituzione perfetta per un cookie HttpOnly: riduce la fuga nei log ma resta leggibile da JavaScript.

### 2.3 Validare TURN e WebRTC

La route `/api/turn-config` restituisce configurazione controllata da environment, ma il client la accetta senza una allowlist esplicita. Prima del deploy:

- permettere solo host TURN attesi;
- non restituire credenziali statiche a tempo indefinito;
- usare credenziali TURN con TTL breve;
- preferire `turns:` su TLS quando disponibile;
- decidere se `ICE_TRANSPORT_POLICY=relay` è necessario per ridurre l'esposizione degli IP;
- testare utenti dietro NAT simmetrico, rete mobile e firewall aziendale.

Senza TURN la videochiamata può fallire per una parte degli utenti. Se il budget non consente un servizio gestito, installare Coturn sulla stessa VPS solo dopo avere misurato RAM, banda e carico.

### 2.4 Limitare `BCRYPT_ROUNDS`

`BCRYPT_ROUNDS` ora viene limitato all'intervallo 10-14, con default 12. In produzione confermare il valore con un benchmark sulla VPS.

### 2.5 Rendere la configurazione esplicita

Creare un file documentale non segreto, ad esempio `server/.env.example`, con nomi, obbligatorietà, default e formato delle variabili. Non inserire password o token reali.

Variabili minime:

```dotenv
NODE_ENV=production
PORT=3000
CLIENT_ORIGIN=https://example.com
JWT_SECRET=<almeno-32-caratteri-casuali>
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?tls=true
REDIS_URL=redis://:<password>@127.0.0.1:6379/0
BCRYPT_ROUNDS=12
SOCKET_TOKEN_TTL_SECONDS=3600
TOKEN_TTL_SECONDS=3600
INSTANCE_ID=anima-prod-1
LOG_INCLUDE_STACK=false
DB_RETRY_BASE_MS=2000
DB_RETRY_MAX_MS=30000
PEER_RATE_LIMIT_WINDOW_MS=60000
PEER_RATE_LIMIT_MAX_REQ=180
SIGNAL_RATE_WINDOW_MS=1000
SIGNAL_RATE_MAX_REQ=5
SNAPSHOT_COOLDOWN_MS=5000
TURN_SERVER_1=
TURN_SERVER_2=
TURN_USERNAME=
TURN_CREDENTIAL=
TURN_CREDENTIAL_TTL=86400
```

Generare il secret senza inserirlo nel repository:

```bash
openssl rand -base64 48
```

### 2.6 Completare la validazione degli input

Prima del pubblico accesso verificare:

- body, query, params e headers validati separatamente;
- errori Zod non espongano dettagli interni non necessari;
- limiti di lunghezza su messaggi, snapshot, SDP e metadata;
- `Content-Type` coerente per POST;
- rate limit sui messaggi Socket.IO, non solo sul token iniziale;
- limiti su numero e durata delle sessioni per utente/IP;
- controllo della lunghezza massima del payload Socket.IO;
- nessun dato utente inserito con `innerHTML`.

---

## 3. Frontend e flusso utente

### 3.1 Collaudo funzionale browser

Con HTTPS e webcam reale verificare manualmente:

1. apertura della lobby;
2. banner privacy e consenso;
3. login con nickname valido;
4. rifiuto di nickname non validi;
5. elenco utenti online;
6. richiesta e accettazione chiamata;
7. rifiuto e blocco chiamata;
8. webcam e microfono consentiti e negati;
9. snapshot aggiornati;
10. chat con messaggio valido, vuoto e troppo lungo;
11. chiusura chiamata da entrambe le parti;
12. refresh pagina durante una sessione;
13. perdita e ripristino di rete;
14. revoca token e riconnessione;
15. comportamento su mobile Chrome/Safari.

### 3.2 Correzioni frontend da completare

- ~~chiamare `peer.destroy()` e fermare tutti i MediaStream track su chiusura, errore e logout.~~ Completato localmente.
- ~~gestire esplicitamente fallimenti di `video.play()`.~~ Completato localmente.
- ~~aggiungere jitter alla riconnessione per evitare richieste simultanee.~~ Completato localmente.
- ~~impostare timeout per heartbeat e rilevare socket mezzo-aperti.~~ Completato localmente.
- validare i parametri della chat prima di inizializzare PeerJS;
- rendere configurabile il path PeerJS, mantenendo `/peerjs/myapp` coerente con Nginx;
- evitare asset CDN esterni non necessari, soprattutto nella pagina autenticata;
- aggiungere CSP e policy di referrer compatibili con WebRTC;
- verificare che i controlli touch siano usabili su schermi piccoli.

### 3.3 Privacy e GDPR minima

Prima del lancio predisporre:

- informativa privacy reale, non solo il banner;
- titolare, finalità, base giuridica e tempi di conservazione;
- procedura per cancellazione account e dati;
- contatto per richieste privacy;
- registro dei dati raccolti: nickname, IP, snapshot, log, token e metadati chiamata;
- retention dei log e dei backup;
- consenso separato quando necessario per webcam/microfono;
- revisione legale prima di un lancio pubblico.

Non dichiarare che audio/video sono registrati o non registrati senza verificare il comportamento reale di tutti i servizi e dei provider.

---

## 4. Infrastruttura economica consigliata

### 4.1 Scelta minima

La soluzione con meno componenti è:

```text
Browser
  -> Nginx + Let's Encrypt sulla VPS
       -> Node/PM2 o container ANIMA ANTICA
       -> Redis locale solo su 127.0.0.1
       -> Coturn opzionale sulla stessa VPS
  -> MongoDB Atlas Free Tier via TLS
```

Costi da pianificare:

- VPS: il prezzo dipende dal provider e dalla regione;
- dominio: normalmente costo annuale;
- HTTPS: gratuito con Let's Encrypt;
- MongoDB Atlas Free Tier: verificare limiti e disponibilità;
- Redis locale: nessun costo extra, ma responsabilità operativa propria;
- TURN: gratuito solo entro i limiti del servizio scelto, altrimenti costo banda.

Non usare provider gratuiti che sospendono il processo, bloccano WebSocket o non offrono IP stabile senza verificare prima Socket.IO e WebRTC.

### 4.2 Preparazione VPS

1. Creare una VPS Ubuntu/Debian aggiornata.
2. Creare un utente amministrativo non root.
3. Disabilitare login SSH con password dopo avere testato una chiave.
4. Limitare SSH al proprio IP se possibile.
5. Abilitare firewall:

   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

6. Non aprire pubblicamente la porta Node 3000 né Redis 6379.
7. Se Coturn usa porte proprie, aprire solo quelle documentate e necessarie.
8. Abilitare aggiornamenti di sicurezza automatici.
9. Impostare timezone e sincronizzazione NTP.
10. Configurare spazio disco e allarme quando supera il 70-80%.

### 4.3 Installazione runtime

Scegliere una sola modalità per la prima produzione.

#### Opzione A: Node + PM2 + Nginx

È la più semplice da diagnosticare su una VPS piccola:

```bash
git clone <repository-privato> /opt/anima-antica
cd /opt/anima-antica
npm ci --omit=dev
NODE_ENV=production npm start
```

Dopo il test manuale, usare PM2 o un servizio systemd. Non lasciare il processo avviato da una shell SSH.

Con PM2:

```bash
npm install --global pm2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

Con una VPS da 1 GB preferire una sola istanza. Non usare `start:cluster` finché non è stato configurato Redis condiviso e verificato il bilanciamento WebSocket.

#### Opzione B: Docker

Il Dockerfile usa Node 20 Alpine, `npm ci --only=production` e l'utente `node`. Prima di usarlo:

1. aggiungere un `HEALTHCHECK` reale;
2. verificare che il container riceva tutte le variabili senza copiarle nell'immagine;
3. montare log tramite stdout/stderr o driver del provider;
4. fissare le versioni e testare `docker build` e `docker run`;
5. non copiare documenti, test o segreti nell'immagine finale;
6. verificare che l'app serva `public/` dopo la correzione static file.

Build di verifica:

```bash
docker build --tag anima-antica:release-candidate .
docker run --rm --env-file /opt/anima-antica/.env -p 127.0.0.1:3000:3000 anima-antica:release-candidate
```

---

## 5. MongoDB e Redis

### 5.1 MongoDB Atlas

1. Creare un cluster nella regione più vicina all'utente/server.
2. Creare un database user con permessi minimi sul database applicativo.
3. Abilitare TLS e usare una URI `mongodb+srv://` verificata.
4. Limitare gli IP autorizzati al solo IP della VPS, non `0.0.0.0/0` salvo test temporaneo.
5. Creare gli indici necessari dopo aver misurato le query:
   - nickname univoco;
   - stato/lastSeen se usati per cleanup e presenza;
   - eventuali query su utenti bloccati.
6. Abilitare backup disponibili nel piano oppure eseguire `mongodump` cifrato giornaliero.
7. Testare restore su database separato.
8. Non stampare mai `MONGO_URI` nei log o nei report.

### 5.2 Redis

Per singola VPS:

1. bind su `127.0.0.1`;
2. ACL/password;
3. limite memoria e politica di eviction consapevole;
4. snapshot o AOF se si accetta il costo disco;
5. monitoraggio memoria e numero chiavi;
6. test di riavvio e riconnessione.

Per più istanze:

1. Redis deve essere condiviso e raggiungibile via TLS;
2. Socket.IO Redis Adapter deve essere testato;
3. rate limit e token registry devono essere distribuiti;
4. non usare Map/Set in-memory come fonte di verità per autenticazione, presenza o stanze;
5. eseguire test di due login/chiamate simultanee su istanze diverse.

---

## 6. Nginx, dominio e HTTPS

### 6.1 DNS

1. Registrare un dominio economico.
2. Creare record `A` verso l'IP pubblico della VPS.
3. Attendere la propagazione e verificare:

   ```bash
   dig +short example.com
   ```

4. Non pubblicare l'IP dell'app su porte diverse da 80/443.

### 6.2 Nginx

Il file `nginx.conf.example` è un punto di partenza, non una configurazione pronta. Prima dell'uso:

- sostituire il dominio placeholder;
- correggere `proxy_set_header X-Forwarded-Proto $https` usando `$scheme` o un valore coerente con il TLS terminato da Nginx;
- aggiungere timeout WebSocket lunghi;
- impostare `proxy_buffering off` per Socket.IO/WebSocket;
- definire `client_max_body_size` coerente con snapshot e API;
- aggiungere HSTS solo dopo avere verificato che tutto funziona in HTTPS;
- conservare i log access/error e ruotarli;
- non esporre `/api/metrics` pubblicamente senza autenticazione o allowlist IP.

Configurazione concettuale minima:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

Applicare una configurazione equivalente anche a `/peerjs/` e al proxy generale, se il path PeerJS deve passare dallo stesso dominio.

### 6.3 Certificato

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
sudo certbot renew --dry-run
```

Dopo il certificato:

- verificare redirect HTTP -> HTTPS;
- verificare `wss://` in Socket.IO;
- verificare `secure: true` in PeerJS;
- verificare webcam/microfono nel browser;
- non abilitare HSTS preload prima di essere certi del dominio e dei sottodomini.

---

## 7. TURN e WebRTC

### 7.1 Perché è necessario

WebRTC può funzionare senza TURN in reti semplici, ma utenti dietro NAT simmetrici, firewall aziendali o reti mobili possono non riuscire a collegarsi. TURN inoltra il traffico e consuma banda, quindi è il componente con il costo operativo più variabile.

### 7.2 Piano economico

1. Provare prima STUN/TURN configurato solo per test.
2. Misurare il successo delle chiamate su almeno tre reti diverse.
3. Se il tasso di fallimento è alto, installare Coturn sulla VPS oppure scegliere un provider TURN con piano iniziale limitato.
4. Usare credenziali temporanee, non una password fissa nel frontend.
5. Applicare limiti di banda e numero connessioni.
6. Monitorare traffico e costo prima di pubblicizzare il servizio.

### 7.3 Test di accettazione WebRTC

- Chrome desktop -> Chrome desktop;
- Chrome -> Safari mobile;
- due reti Wi-Fi diverse;
- Wi-Fi -> rete mobile;
- rete con firewall restrittivo;
- chiamata con microfono negato;
- chiusura improvvisa browser;
- riconnessione dopo cambio rete.

Registrare successo/fallimento e il candidato ICE utilizzato, senza loggare token o dati personali.

---

## 8. Backup, ripristino e continuità

### 8.1 MongoDB

Impostare almeno:

- backup giornaliero;
- conservazione minima 7-30 giorni in base al costo;
- una copia fuori dalla VPS;
- cifratura del backup;
- test di ripristino mensile;
- procedura scritta per cambiare `MONGO_URI` verso un database ripristinato.

Esempio concettuale:

```bash
mongodump --uri "$MONGO_URI" --archive="/backup/anima-$(date +%F).archive" --gzip
```

Il file deve poi essere copiato su storage esterno. Non conservare l'unica copia sulla stessa VPS.

### 8.2 Redis

Redis contiene principalmente sessioni/token e stato temporaneo. Decidere esplicitamente se il ripristino Redis è necessario. Se non lo è, un riavvio può invalidare le sessioni e richiedere nuovo login. Se lo è, configurare persistenza, backup e cifratura.

### 8.3 Procedura di disaster recovery

Scrivere e provare:

1. ricreazione VPS;
2. ripristino DNS;
3. installazione runtime;
4. recupero segreti da un archivio sicuro;
5. restore MongoDB;
6. avvio Redis;
7. avvio app;
8. rinnovo certificato;
9. smoke test;
10. comunicazione agli utenti.

Definire RPO e RTO realistici, anche se inizialmente sono rispettivamente 24 ore e 2 ore.

---

## 9. Test pre-produzione ordinati

Eseguire su una macchina pulita o in un ambiente staging.

### Fase A - qualità locale

```powershell
npm ci
node --check server/server.js
node --check server/redis.js
node --check server/db.js
node --check server/tokenRegistry.js
node --check server/controllers/socketController.js
node --check public/main.js
node --check public/chat.js
npm run test:unit
npm audit --omit=dev --audit-level=high
```

Il comando `npm run test:unit` usa ora il glob corretto della directory `tests/` e termina automaticamente. Il test che richiede Redis viene marcato skipped quando il servizio non è disponibile.

### Fase B - smoke test server

Con tutte le variabili impostate:

```bash
NODE_ENV=production PORT=3000 npm start
```

Verificare:

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/chat.html
curl -i http://127.0.0.1:3000/api/health
curl -i http://127.0.0.1:3000/api/health/token-registry
curl -i http://127.0.0.1:3000/api/metrics
curl -i http://127.0.0.1:3000/api/turn-config
```

Atteso:

- HTML 200 per lobby e chat;
- health 200 solo quando MongoDB è pronto;
- nessun stack trace o segreto nella risposta;
- metrics funzionanti o disabilitate con risposta esplicita;
- route token soggetta a rate limit.

### Fase C - sicurezza HTTP

- `curl` con Origin consentita;
- `curl` con Origin non consentita;
- richiesta senza Origin in produzione;
- richiesta POST con body invalido;
- verifica headers Helmet;
- verifica `Strict-Transport-Security` dopo TLS;
- verifica che `/server/.env`, `/documenti/` e file interni non siano raggiungibili;
- verifica che `/api/metrics` non sia pubblico senza controllo.

### Fase D - rate limit e auth

- sei richieste rapide a `/api/socket-token` devono produrre un `429` entro la finestra;
- token scaduto rifiutato;
- token revocato rifiutato;
- token con algoritmo diverso da HS256 rifiutato;
- fingerprint IP/User-Agent alterato rifiutato;
- token riutilizzato da socket concorrente rifiutato;
- ban temporaneo verificato senza bloccare utenti legittimi in modo permanente.

### Fase E - carico minimo

Misurare con un carico conservativo:

- CPU;
- RAM;
- event loop lag;
- connessioni MongoDB;
- memoria Redis;
- banda TURN;
- numero socket attivi;
- errori 429/5xx;
- tempo risposta health e token.

Non usare i valori di load test attuali come valori di produzione senza una misurazione: `PEER_MAX_CONNECTIONS_PER_IP=1000` è particolarmente aggressivo per una VPS piccola.

---

## 10. Logging, monitoraggio e allarmi low-cost

Per il budget minimo usare prima strumenti semplici:

1. stdout/stderr dell'app raccolti da systemd/PM2/Docker;
2. logrotate per Nginx e PM2;
3. `uptime` esterno gratuito per `/api/health`;
4. script cron che verifica disco, RAM, processo e scadenza certificato;
5. alert email o webhook solo per errori critici;
6. endpoint metriche protetto da rete o autenticazione.

Allarmi minimi:

- sito non raggiungibile;
- health 503 per più di alcuni minuti;
- spazio disco oltre 80%;
- RAM oltre 85%;
- processo riavviato più volte;
- errori 5xx sopra soglia;
- MongoDB non raggiungibile;
- Redis non raggiungibile;
- certificato in scadenza entro 14 giorni;
- aumento anomalo di 429 e ban.

Non inviare nei log token, password, URI completi, snapshot, SDP completi o dati personali non necessari.

---

## 11. Go-live operativo

### Prima della finestra di rilascio

- [ ] Branch/tag di release creato.
- [x] Tutti i test automatici passano e contano realmente i test: 23 passati, 1 skipped senza Redis.
- [x] Audit npm rivisto dopo l'override `qs`: 0 vulnerabilità rilevate.
- [ ] Backup MongoDB verificato e restore provato.
- [ ] VPS aggiornata e firewall attivo.
- [ ] Segreti creati fuori dal repository.
- [ ] DNS pronto.
- [ ] Nginx configurato e testato.
- [ ] Certificato Let's Encrypt installato.
- [ ] MongoDB con TLS e allowlist IP.
- [ ] Redis protetto e non pubblico.
- [ ] TURN verificato o decisione documentata di partire senza TURN.
- [ ] Pagina privacy e contatto pubblicati.
- [ ] Piano rollback pronto.

### Durante il rilascio

1. Creare backup finale.
2. Fermare eventuale vecchia istanza.
3. Installare esattamente il commit/tag scelto.
4. Eseguire `npm ci --omit=dev`.
5. Caricare `.env` tramite secret store/file con permessi 600.
6. Avviare una sola istanza.
7. Verificare log di avvio e health.
8. Attivare Nginx e HTTPS.
9. Eseguire smoke test HTTP, Socket.IO e WebRTC.
10. Monitorare per almeno 30-60 minuti.

### Rollback

Se health, login o chiamate falliscono:

1. bloccare nuovo traffico se necessario;
2. tornare al tag precedente;
3. riavviare una sola istanza;
4. verificare health e accesso;
5. conservare log e causa dell'incidente;
6. non cancellare il database per risolvere un problema applicativo;
7. correggere in staging e ripetere il ciclo.

---

## 12. Ordine pratico finale, senza ambiguità

1. ~~Correggere static file e route health/metrics.~~ Completato localmente; ripetere lo smoke test dopo il deploy.
2. ~~Correggere lo script `test:unit`.~~ Completato; la suite termina automaticamente.
3. Risolvere o accettare formalmente le vulnerabilità `npm audit`.
4. ~~Implementare schema WebRTC al posto di `z.any()`.~~ Completato localmente; aggiungere ulteriori casi di abuso.
5. ~~Rimuovere token sensibili dalle query string.~~ Completato localmente; valutare in futuro cookie HttpOnly.
6. ~~Validare `BCRYPT_ROUNDS` e creare il template env.~~ Completato localmente; verificare ancora la configurazione Redis dinamica.
7. Creare `.env.example` documentale e secret checklist.
8. Configurare MongoDB Atlas con TLS, utente minimo e backup.
9. Installare e proteggere Redis.
10. Decidere TURN e testare WebRTC su reti diverse.
11. Preparare VPS, firewall, aggiornamenti e backup.
12. Configurare Nginx per HTTP, HTTPS, Socket.IO e PeerJS.
13. Installare certificato Let's Encrypt e testare rinnovo.
14. Eseguire test automatici, smoke test, auth test e browser test.
15. Pubblicare una sola istanza con PM2/systemd o Docker.
16. Monitorare errori, memoria, disco, Redis, MongoDB e certificato.
17. Eseguire il primo backup post-rilascio.
18. Documentare versione, configurazione, incidenti e rollback.
19. Solo dopo stabilità reale valutare seconda istanza e bilanciamento.

### Criterio di successo

ANIMA ANTICA è pronta per un rilascio iniziale solo quando:

- la lobby e la chat sono servite via HTTPS;
- il server parte da una macchina pulita con soli secret esterni;
- health, metrics e static file rispondono correttamente;
- MongoDB e Redis sono raggiungibili in modo sicuro;
- rate limiting, revoca e fingerprint binding sono verificati;
- almeno una chiamata WebRTC riesce su reti diverse;
- backup e restore sono stati provati;
- non esistono vulnerabilità critiche non valutate;
- esiste una procedura di rollback testata;
- il proprietario sa chi contattare e cosa controllare quando il servizio degrada.
