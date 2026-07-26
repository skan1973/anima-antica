const http = require('http');
const { z } = require('zod');

// Schema identico a quello del server per il test
const callRequestSchema = z.object({
  targetNick: z.string().min(3).max(24).regex(/^[a-zA-Z0-9._-]+$/)
});

function runSecurityTests() {
  console.log('--- Avvio Test di Sicurezza Minimalista ---');

  const payloads = [
    { targetNick: 'validNick' },             // Valido
    { targetNick: 'a' },                     // Troppo corto
    { targetNick: '<script>alert(1)</script>' }, // Iniezione/Caratteri non permessi
    { targetNick: 'nickname_molto_molto_molto_lungo' } // Troppo lungo
  ];

  payloads.forEach((payload, index) => {
    const result = callRequestSchema.safeParse(payload);
    const status = result.success ? 'PASSATO' : 'BLOCCATO (Corretto)';
    console.log(`Test ${index + 1}: Input ${JSON.stringify(payload)} -> ${status}`);
  });

  console.log('--- Test Conclusi ---');
}

runSecurityTests();
