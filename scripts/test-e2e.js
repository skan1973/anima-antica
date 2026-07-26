const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nodeBin = process.execPath;

function waitForServerReady(serverProc, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Timeout attesa avvio server'));
    }, timeoutMs);

    const onData = (chunk) => {
      const line = chunk.toString();
      process.stdout.write(line);
      if (line.includes('Server ANIMA ANTICA in ascolto sulla porta')) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    };

    serverProc.stdout.on('data', onData);
    serverProc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk.toString());
    });

    serverProc.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Server terminato prematuramente con codice ${code}`));
    });
  });
}

function runCallTest() {
  return new Promise((resolve, reject) => {
    const testProc = spawn(nodeBin, ['test-chiamata.js'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    testProc.stdout.on('data', (chunk) => process.stdout.write(chunk.toString()));
    testProc.stderr.on('data', (chunk) => process.stderr.write(chunk.toString()));

    testProc.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Test chiamata fallito con codice ${code}`));
    });
  });
}

(async () => {
  const serverProc = spawn(nodeBin, ['server/server.js'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServerReady(serverProc);
    await runCallTest();
    console.log('E2E_OK');
    process.exitCode = 0;
  } catch (err) {
    console.error('E2E_ERR', err.message);
    process.exitCode = 1;
  } finally {
    if (!serverProc.killed) {
      serverProc.kill('SIGINT');
    }
  }
})();
