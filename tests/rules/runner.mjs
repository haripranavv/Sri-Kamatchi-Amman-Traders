/**
 * runner.mjs — Firestore Emulator Test Runner
 * 
 * 1. Boots local Firestore Emulator on 127.0.0.1:8080 with ../../firestore.rules.
 * 2. Waits for health probe to pass.
 * 3. Executes the test suite with FIRESTORE_EMULATOR_HOST=127.0.0.1:8080.
 * 4. Gracefully terminates the emulator upon test completion.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate Java 21 or system java
const javaPath = 'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe';
const jarPath = path.resolve(__dirname, 'emulator/cloud-firestore-emulator.jar');
const rulesPath = path.resolve(__dirname, '../../firestore.rules');

const EMULATOR_PORT = 8085;
const EMULATOR_HOST = '127.0.0.1';

console.log('================================================================');
console.log('FIRESTORE SECURITY RULES EMULATOR TEST HARNESS');
console.log('================================================================');
console.log('[Runner] Target Rules:', rulesPath);
console.log('[Runner] Emulator JAR:', jarPath);
console.log(`[Runner] Booting Java Firestore Emulator on ${EMULATOR_HOST}:${EMULATOR_PORT}...\n`);

let emulatorOutput = '';

const emulator = spawn(javaPath, [
  '-jar', jarPath,
  `--host=${EMULATOR_HOST}`,
  `--port=${EMULATOR_PORT}`,
  `--rules=${rulesPath}`
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

emulator.stdout.on('data', (d) => {
  const line = d.toString();
  emulatorOutput += line;
  process.stdout.write(`[Emulator] ${line}`);
});

emulator.stderr.on('data', (d) => {
  const line = d.toString();
  emulatorOutput += line;
  process.stdout.write(`[Emulator] ${line}`);
});

emulator.on('error', (err) => {
  console.error('[Runner] Failed to start emulator process:', err);
  process.exit(1);
});

// Wait for emulator readiness by checking stdout/stderr or port
async function waitForEmulator(port, maxAttempts = 40) {
  for (let i = 1; i <= maxAttempts; i++) {
    if (emulatorOutput.includes('Dev App Server is now running') || emulatorOutput.includes('listening on')) {
      return true;
    }
    // Also try connecting to root
    const ready = await new Promise((resolve) => {
      const req = http.get(`http://${EMULATOR_HOST}:${port}/`, (res) => {
        // Firestore emulator returns 200 on / or specific response
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
    if (ready && (emulatorOutput.includes('CloudFirestore') || emulatorOutput.includes('Dev App Server') || i > 5)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const isReady = await waitForEmulator(EMULATOR_PORT);
if (!isReady) {
  console.error(`[Runner] FATAL: Firestore emulator failed to bind to ${EMULATOR_HOST}:${EMULATOR_PORT} within timeout.`);
  emulator.kill();
  process.exit(1);
}

console.log(`\n[Runner] Firestore Emulator is healthy and listening on ${EMULATOR_HOST}:${EMULATOR_PORT}.`);
console.log('[Runner] Launching Node.js security rules test suite...\n');

const testSuite = spawn(process.execPath, [
  '--test',
  path.resolve(__dirname, 'firestore.rules.test.mjs')
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FIRESTORE_EMULATOR_HOST: `${EMULATOR_HOST}:${EMULATOR_PORT}`
  }
});

testSuite.on('exit', (code) => {
  console.log(`\n================================================================`);
  console.log(`[Runner] Test execution complete. Exit code: ${code}`);
  console.log(`[Runner] Shutting down Firestore Emulator process...`);
  emulator.kill();
  console.log(`[Runner] Harness teardown complete.`);
  console.log(`================================================================`);
  process.exit(code ?? 0);
});
