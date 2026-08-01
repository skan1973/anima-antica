# Strategia di Deployment: Messa Online di ANIMA ANTICA

Questa strategia è ottimizzata per gestire fino a 1.000 utenti garantendo massima efficienza e minimi costi operativi (budget limitato).

## La Strategia Vincente: Hetzner (VPS) + Docker

Per gestire un'architettura basata su **Socket.io** e **PeerJS**, che richiede connessioni persistenti, i servizi PaaS (come Render o Railway) possono risultare costosi. La soluzione ideale è un server dedicato (VPS) con Docker.

### 1. Checklist per stare nel budget
*   **Server (VPS):** Utilizza [Hetzner Cloud](https://www.hetzner.com/cloud). Un'istanza `CPX11` (o equivalente entry-level) è ampiamente sufficiente per gestire il carico iniziale.
    *   **Costo stimato:** ~4-5€ al mese.
*   **Dominio & Sicurezza:** Usa [Cloudflare](https://www.cloudflare.com/) per gestire il DNS. È gratuito, offre protezione DDoS (fondamentale per siti con Socket) e gestisce il certificato SSL (HTTPS) senza costi aggiuntivi.
*   **Database:** Continua a utilizzare [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) nella versione "Shared Cluster" (piano gratuito). Il limite di 500MB è più che sufficiente per 1.000 utenti.

### 2. Perché questa configurazione ti fa risparmiare
*   **Costi prevedibili:** Paghi solo il canone fisso del server.
*   **Database Gratuito:** Zero costi di gestione per il DB.
*   **Protezione DDoS:** Cloudflare scherma il tuo server da attacchi malevoli che potrebbero causare downtime.

### 3. Prossimi Passi Operativi
Per rendere ANIMA ANTICA finalmente online:
1.  **Acquisto Dominio:** Registra il tuo dominio (costo annuo circa 10-15€).
2.  **Acquisto VPS:** Configura la macchina Linux su Hetzner.
3.  **Deploy con Docker:** Installa Docker sul server remoto e avvia il tuo container (già ottimizzato e pronto nel progetto).

---
*Documento creato per la finalizzazione della messa online del progetto.*
