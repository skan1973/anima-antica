# ANIMA ANTICA - Passi finali rimanenti

Aggiornato dopo il commit `4665379`.

Le correzioni locali principali sono gia state eseguite: frontend statico, health/metrics, schema WebRTC, `BCRYPT_ROUNDS`, audit npm, test automatici, gestione sessione senza token nella URL, cleanup WebRTC, graceful shutdown, healthcheck Docker e hardening Nginx di base.

Questa scaletta contiene solo cio che resta da fare per la produzione.

---

## 1. Configurare i servizi applicativi

### 1.1 MongoDB Atlas

- [ ] Creare il cluster nella regione piu vicina alla VPS.
- [ ] Creare un database user con permessi minimi.
- [ ] Limitare Network Access all'IP pubblico della VPS.
- [ ] Usare una URI `mongodb+srv://` con TLS.
- [ ] Verificare pool, timeout e connessione reale dal server.
- [ ] Creare o verificare gli indici per nickname, stato e presenza.
- [ ] Abilitare il backup disponibile nel piano scelto.
- [ ] Eseguire un primo `mongodump` cifrato.
- [ ] Provare il restore su un database separato.

Comandi indicativi:

```bash
mongodump --uri "$MONGO_URI" --archive="/backup/anima-$(date +%F).archive" --gzip
mongorestore --uri "$RESTORE_URI" --archive="/backup/anima-YYYY-MM-DD.archive" --gzip
```

Non salvare URI, password o dump nel repository.

### 1.2 Redis

- [ ] Installare Redis locale sulla VPS oppure scegliere un Redis gestito.
- [ ] Bindare Redis a `127.0.0.1` se e sulla stessa VPS.
- [ ] Configurare ACL/password.
- [ ] Non esporre la porta 6379 a Internet.
- [ ] Decidere se abilitare AOF/RDB per token e stato temporaneo.
- [ ] Verificare il client realmente connesso, non solo il valore iniziale esportato dal modulo.
- [ ] Testare riavvio Redis, perdita di connessione e riconnessione.
- [ ] Eseguire il test di integrazione Redis attualmente saltato senza servizio.
- [ ] Verificare rate limit, token registry, presence e invalidazione cross-instance.

Per il primo rilascio usare una sola istanza Node. Il cluster a tre istanze richiede Redis condiviso e test distribuiti.

### 1.3 TURN/WebRTC

- [ ] Decidere se usare Coturn sulla VPS o un provider TURN.
- [ ] Configurare credenziali TURN con TTL, non password permanenti esposte al client.
- [ ] Preferire `turns:` su TLS quando disponibile.
- [ ] Limitare domini e host TURN accettabili.
- [ ] Impostare limiti di banda e connessioni.
- [ ] Decidere se usare `ICE_TRANSPORT_POLICY=all` o `relay` in base al requisito privacy.
- [ ] Testare chiamate su Wi-Fi, rete mobile, NAT simmetrico e firewall aziendale.
- [ ] Misurare consumo banda e costo prima del lancio pubblico.

Senza TURN alcune chiamate WebRTC possono fallire. Non dichiarare il servizio pronto prima dei test su reti diverse.

---

## 2. Completare i test di integrazione

### 2.1 Redis e database

- [ ] Avviare Redis di test.
- [ ] Eseguire test token registry con Redis disponibile.
- [ ] Verificare revoca propagata tra memoria e Redis.
- [ ] Verificare revoca durante outage Redis e migrazione al ripristino.
- [ ] Verificare invalidazione Socket.IO tra due istanze.
- [ ] Eseguire i test con MongoDB reale o ambiente isolato equivalente.
- [ ] Verificare startup cleanup su dati reali di staging.

### 2.2 Autenticazione e abuso

- [ ] Testare token scaduto.
- [ ] Testare token revocato.
- [ ] Testare algoritmo JWT `none`.
- [ ] Testare algoritmo diverso da HS256.
- [ ] Testare fingerprint con IP/User-Agent modificati.
- [ ] Testare replay dello stesso token su socket concorrenti.
- [ ] Testare rate limit su `/api/socket-token` e risposta `429`.
- [ ] Testare ban temporaneo e scadenza del ban.
- [ ] Testare payload Socket.IO oltre i limiti.
- [ ] Testare messaggi troppo lunghi e input non validi.

### 2.3 Browser e WebRTC

- [ ] Testare lobby, login ed elenco utenti.
- [ ] Testare chiamata, accettazione, rifiuto, blocco e chiusura.
- [ ] Testare webcam/microfono consentiti e negati.
- [ ] Testare chat valida, vuota e oltre il limite.
- [ ] Testare refresh durante una sessione.
- [ ] Testare perdita e ripristino della rete.
- [ ] Testare Chrome desktop, Safari mobile e almeno due reti diverse.
- [ ] Verificare che token e dati sensibili non compaiano in URL, log o Referer.

---

## 3. Preparare la produzione economica

### 3.1 VPS

- [ ] Scegliere una VPS Linux con almeno 1-2 GB RAM e IPv4 pubblico.
- [ ] Creare un utente amministrativo non root.
- [ ] Usare autenticazione SSH con chiave.
- [ ] Disabilitare il login SSH con password dopo il test della chiave.
- [ ] Aggiornare il sistema operativo.
- [ ] Installare Node 20, il range dichiarato dal progetto.
- [ ] Installare Nginx.
- [ ] Installare Redis se scelto localmente.
- [ ] Configurare firewall con sole porte 22, 80 e 443 pubbliche.
- [ ] Non esporre direttamente la porta Node 3000.
- [ ] Configurare aggiornamenti di sicurezza automatici.
- [ ] Controllare RAM, disco, CPU e sincronizzazione oraria.

### 3.2 Segreti

- [ ] Creare `.env` direttamente sulla VPS, con permessi `600`.
- [ ] Impostare `NODE_ENV=production`.
- [ ] Impostare `CLIENT_ORIGIN` con il dominio HTTPS reale.
- [ ] Generare `JWT_SECRET` con almeno 32 caratteri casuali.
- [ ] Impostare `MONGO_URI` con TLS.
- [ ] Impostare `REDIS_URL` protetto.
- [ ] Impostare `METRICS_TOKEN` casuale.
- [ ] Configurare `BCRYPT_ROUNDS` dopo benchmark sulla VPS.
- [ ] Impostare `TURN_*` dopo avere verificato il provider TURN.
- [ ] Non copiare `.env` in Git, Docker image, log o ticket.

Generazione secret:

```bash
openssl rand -base64 48
```

### 3.3 Installazione applicazione

Scegliere una sola modalita per il primo rilascio.

#### PM2/systemd

```bash
git clone <repository-privato> /opt/anima-antica
cd /opt/anima-antica
npm ci --omit=dev
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

Usare una sola istanza finche Redis condiviso e Socket.IO distribuito non sono stati collaudati.

#### Docker

```bash
docker build --tag anima-antica:release-candidate .
docker run --rm --env-file /opt/anima-antica/.env \
  -p 127.0.0.1:3000:3000 anima-antica:release-candidate
```

- [ ] Verificare il `HEALTHCHECK`.
- [ ] Verificare che l'immagine non contenga segreti o documenti interni.
- [ ] Usare stdout/stderr e rotazione log del runtime.
- [ ] Provare riavvio e rollback dell'immagine.

---

## 4. Dominio, Nginx e HTTPS

- [ ] Registrare un dominio.
- [ ] Creare record DNS `A` verso la VPS.
- [ ] Verificare la propagazione DNS.
- [ ] Sostituire il dominio placeholder in `nginx.conf.example`.
- [ ] Configurare proxy per `/`, `/socket.io/` e `/peerjs/`.
- [ ] Verificare `Upgrade`, `Connection`, `X-Forwarded-For` e `X-Forwarded-Proto`.
- [ ] Mantenere `proxy_buffering off` e timeout WebSocket lunghi.
- [ ] Impostare `client_max_body_size` coerente con snapshot e API.
- [ ] Proteggere `/api/metrics` con `METRICS_TOKEN` o allowlist di rete.
- [ ] Installare Let's Encrypt.
- [ ] Verificare rinnovo con `certbot renew --dry-run`.
- [ ] Verificare redirect HTTP -> HTTPS.
- [ ] Verificare Socket.IO su `wss://`.
- [ ] Verificare PeerJS su HTTPS.
- [ ] Abilitare HSTS solo dopo avere verificato completamente HTTPS.

Comandi indicativi:

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
sudo certbot renew --dry-run
```

---

## 5. Backup e disaster recovery

- [ ] Definire RPO e RTO iniziali, ad esempio 24 ore e 2 ore.
- [ ] Pianificare backup MongoDB giornaliero.
- [ ] Conservare almeno una copia fuori dalla VPS.
- [ ] Cifrare i backup.
- [ ] Definire retention di 7-30 giorni.
- [ ] Provare un restore su database separato.
- [ ] Decidere se Redis deve essere ripristinabile o se la perdita comporta solo nuovo login.
- [ ] Scrivere la procedura per ricreare la VPS.
- [ ] Scrivere la procedura di rollback al tag precedente.
- [ ] Conservare fuori dal server i secret necessari al ripristino.

---

## 6. Monitoraggio low-cost

- [ ] Usare un monitor esterno gratuito su `/api/health`.
- [ ] Configurare logrotate per Nginx e PM2/Docker.
- [ ] Controllare spazio disco sopra 80%.
- [ ] Controllare RAM sopra 85%.
- [ ] Controllare riavvii ripetuti del processo.
- [ ] Controllare errori HTTP 5xx.
- [ ] Controllare MongoDB e Redis.
- [ ] Controllare scadenza certificato entro 14 giorni.
- [ ] Controllare aumento anomalo di 429 e ban.
- [ ] Non loggare password, token, URI completi, snapshot o SDP completi.

---

## 7. Checklist go-live

- [ ] Tutti i test locali passano su Node 20.
- [ ] Test Redis eseguiti con Redis reale.
- [ ] Test MongoDB e TLS eseguiti.
- [ ] Test TURN/WebRTC eseguiti su reti diverse.
- [ ] Backup e restore verificati.
- [ ] VPS aggiornata e firewall attivo.
- [ ] `.env` creato fuori dal repository.
- [ ] DNS propagato.
- [ ] Nginx verificato.
- [ ] HTTPS e rinnovo certificato verificati.
- [ ] Smoke test `/`, `/chat.html`, `/api/health` e `/api/turn-config`.
- [ ] Rate limit e revoca token verificati in staging.
- [ ] Una sola istanza avviata con PM2/systemd o Docker.
- [ ] Monitoraggio attivo.
- [ ] Piano rollback pronto.
- [ ] Tag di release creato.

ANIMA ANTICA sara pronta per il primo rilascio quando tutte le caselle di questa sezione saranno completate, con particolare attenzione a Redis, MongoDB TLS, TURN, backup e HTTPS.
