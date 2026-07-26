# Prompt per il Team di Agenti

Il team deve fare riferimento al file `documenti/scaletta-definitiva.md` per le priorità di business e tecniche.

---

### Prompt 1: Configurazione, Pulizia e Sicurezza
# Prompt per il Team di Agenti

Il team deve fare riferimento al file `documenti/scaletta-definitiva.md` per le priorità di business e tecniche.

**ISTRUZIONE OBBLIGATORIA PER TUTTI GLI AGENTI:**
Al termine di ogni analisi, dovrai fornire:
1. **Analisi Tecnica:** Il risultato dettagliato della tua indagine.
2. **Action Plan:** Una scaletta numerata delle azioni concrete da intraprendere (es. comandi da eseguire, file da modificare, porzioni di codice da riscrivere).

---

### Prompt 1: Configurazione, Pulizia e Sicurezza
**Agente: AUDIT — Security Expert**
> "In riferimento alla `documenti/scaletta-definitiva.md` (Fase 1), analizza il progetto in modo paranoico. Identifica hardcoding di credenziali, file sensibili versionati (come `node_modules` o `.env`) e potenziali falle di sicurezza. Fornisci un'analisi tecnica e la scaletta delle azioni necessarie per la messa in sicurezza."

### Prompt 2: Rafforzamento Codice, Validazione e SOLID
**Agente: CHAT — Planner (Security Focused)**
> "In riferimento alla `documenti/scaletta-definitiva.md` (Fase 2), esegui il refactoring del backend. Implementa una validazione rigorosa degli input tramite `zod` in `server/controllers/` e `server/schemas/` per prevenire iniezioni. Applica i principi SOLID e il Defensive Programming. Fornisci un'analisi tecnica e la scaletta delle azioni necessarie."

### Prompt 3: Organizzazione Frontend
**Agente: CHAT — Planner (Security Focused)**
> "Seguendo le linee guida della `documenti/scaletta-definitiva.md` (Fase 2, punto 3), analizza la cartella `public/`. Pulisci la directory rimuovendo i file di test e organizzando la struttura dei file di produzione. Verifica che il collegamento tra `main.js` e `index.html` sia sicuro e funzionale. Fornisci un'analisi tecnica e la scaletta delle azioni necessarie."

### Prompt 4: Infrastruttura e Deploy
**Agente: APPLY — Ops (DevOps Engineer)**
> "In base alla `documenti/scaletta-definitiva.md` (Fase 3), prepara il progetto per il deploy sicuro. Crea un `Dockerfile` (multi-stage) che minimizzi le vulnerabilità di runtime. Genera una configurazione di `pm2` (`ecosystem.config.js`) e fornisci istruzioni per configurare Nginx come reverse proxy per la terminazione SSL/TLS. Fornisci un'analisi tecnica e la scaletta delle azioni necessarie."

### Prompt 5: QA, Testing Avanzato e Supervisione Finale
**Agente: Gemini 3.1 Flash-Lite (Supervisore)**
> "Seguendo la `documenti/scaletta-definitiva.md` (Fase 4 e Fase 5), esegui una revisione finale dell'intero operato del team. Genera unit test focalizzati su casi limite e input malevoli. Verifica la pipeline CI/CD in `.github/workflows/`. Definisci le istruzioni operative per la Fase 5: Monitoraggio, Backup Atlas e gestione SSL. Fornisci un'analisi tecnica e la scaletta delle azioni necessarie per il go-live."
> "In riferimento alla `documenti/scaletta-definitiva.md` (Fase 1), analizza il progetto in modo paranoico. Identifica hardcoding di credenziali, file sensibili versionati (come `node_modules` o `.env`) e potenziali falle di sicurezza nel codice esistente. Fornisci la correzione sicura per ogni problema riscontrato."

### Prompt 2: Rafforzamento Codice, Validazione e SOLID
**Agente: CHAT — Planner (Security Focused)**
> "In riferimento alla `documenti/scaletta-definitiva.md` (Fase 2), esegui il refactoring del backend. Implementa una validazione rigorosa degli input tramite `zod` in `server/controllers/` e `server/schemas/` per prevenire iniezioni. Applica i principi SOLID e il Defensive Programming per rendere il codice modulare e robusto, come richiesto nella Fase 2."

### Prompt 3: Organizzazione Frontend
**Agente: CHAT — Planner (Security Focused)**
> "Seguendo le linee guida della `documenti/scaletta-definitiva.md` (Fase 2, punto 3), analizza la cartella `public/`. Pulisci la directory rimuovendo i file di test e organizzando la struttura dei file di produzione. Verifica che il collegamento tra `main.js` e `index.html` sia sicuro e funzionale."

### Prompt 4: Infrastruttura e Deploy
**Agente: APPLY — Ops (DevOps Engineer)**
> "In base alla `documenti/scaletta-definitiva.md` (Fase 3), prepara il progetto per il deploy sicuro. Crea un `Dockerfile` (multi-stage) che minimizzi le vulnerabilità di runtime. Genera una configurazione di `pm2` (`ecosystem.config.js`) e fornisci uno script o istruzioni per configurare Nginx come reverse proxy per la terminazione SSL/TLS."

### Prompt 5: QA, Testing Avanzato e Supervisione Finale
**Agente: Gemini 3.1 Flash-Lite (Supervisore)**
> "Seguendo la `documenti/scaletta-definitiva.md` (Fase 4 e Fase 5), esegui una revisione finale dell'intero operato del team. Genera unit test focalizzati su casi limite e input malevoli (usando il comando /test-edge). Verifica la pipeline CI/CD in `.github/workflows/`. Infine, definisci le istruzioni operative per la Fase 5: Monitoraggio, Backup Atlas, e gestione SSL, per garantire che il progetto sia pronto per il go-live."

