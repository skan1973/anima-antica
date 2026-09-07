## Albero verificato

Struttura rilevata nel workspace, con `.git/` e `node_modules/` escluse.

```text
ANIMA_ANTICA/
├── .dockerignore
├── .github/
│   ├── evals/
│   │   └── token-saver/
│   │       ├── eval.yaml
│   │       └── tasks/
│   │           ├── negative-trigger-1.yaml
│   │           ├── positive-trigger-1.yaml
│   │           └── positive-trigger-2.yaml
│   ├── skills/
│   │   └── token-saver/
│   │       └── SKILL.md
│   └── workflows/
│       ├── sast.yml
│       ├── secret-scan.yml
│       └── security-audit.yml
├── .gitignore
├── .vscode/
│   └── settings.json
├── Dockerfile
├── documenti/
│   ├── albero_ANIMA_ANTICA.md
│   ├── atlas-credentials.env
│   ├── documentazione_progetto.md
│   ├── DOCUMENTAZIONE_SICUREZZA.md
│   ├── fix_scheda_001.md
│   ├── mongo.txt
│   ├── passi_finali.md
│   ├── scheda-_101_FIX.md
│   ├── schede_fase0.md
│   ├── schede_fase1.md
│   ├── schede_fase2.md
│   ├── schede_fase3.md
│   ├── sostieni_anima_antica.md
│   └── verifica_completa_001.md
├── ecosystem.config.js
├── jest.config.js
├── nginx.conf.example
├── package-lock.json
├── package.json
├── public/
│   ├── chat.css
│   ├── chat.html
│   ├── chat.js
│   ├── index.html
│   ├── main.js
│   └── style.css
├── scripts/
│   ├── atlas-check.js
│   ├── load-test.js
│   ├── seed-fake-users.js
│   ├── test-chiamata.js
│   ├── test-e2e.js
│   ├── test_auth_hardening.js
│   ├── test_fault_injection.js
│   ├── test_pubsub.js
│   └── test_rate_limits.js
├── server/
│   ├── .env
│   ├── .env.example
│   ├── config.js
│   ├── controllers/
│   │   └── socketController.js
│   ├── db.js
│   ├── logger.js
│   ├── metrics.js
│   ├── middleware/
│   │   ├── socketValidator.js
│   │   └── validator.js
│   ├── models/
│   │   └── ban.js
│   ├── redis.js
│   ├── schemas/
│   │   ├── authSchema.js
│   │   ├── callSchema.js
│   │   ├── messageSchema.js
│   │   ├── socketEventsSchema.js
│   │   └── userLoginSchema.js
│   ├── server.js
│   ├── services/
│   │   ├── banService.js
│   │   ├── sessionService.js
│   │   ├── stateService.js
│   │   └── tokenInvalidator.js
│   ├── tests/
│   │   ├── testContainers.js
│   │   └── tokenRegistry.e2e.test.js
│   └── tokenRegistry.js
├── server_error.log
├── struttura.txt
├── test.txt
├── test_cors.js
└── tests/
    ├── banService.test.js
    ├── README.md
    ├── schemas.test.js
    ├── stateRecovery.test.js
    └── stateService.test.js
```

### Verifica

- File elencati: 79
- Directory elencate: 19
- Escluse: `.git/` e `node_modules/`
- File o directory non elencati per troncamento: nessuno rilevato
- Collegamenti simbolici: non verificati