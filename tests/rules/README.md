# Firestore Security Rules Test Harness

Automated security rules test suite for **Sri Kamatchi Amman Traders**.
Uses `@firebase/rules-unit-testing` and Google's official standalone Cloud Firestore Emulator (`cloud-firestore-emulator.jar`).

## Isolation Guarantee
- All test dependencies and runner scripts live strictly in `tests/rules/`.
- Evaluates against the root `../../firestore.rules` without altering storefront or production files.
- Uses mock test credentials (`cust_alice_101`, `cust_bob_202`, `admin_ravi_999`) and mock project `sri-kamatchi-rules-test`.
- Does not deploy to Firebase or communicate with live production Firestore.

## How to Run
From the project root:
```bash
npm --prefix tests/rules test
```
Or directly from `tests/rules`:
```bash
cd tests/rules
node runner.mjs
```

## Structure
- `runner.mjs`: Orchestrator that boots the Java Firestore Emulator on `127.0.0.1:8085`, waits for readiness, runs tests, and terminates cleanly.
- `firestore.rules.test.mjs`: Test suite containing 28 real Firestore security rule assertions across 5 suites.
- `emulator/cloud-firestore-emulator.jar`: Official standalone emulator binary from Google Cloud Storage.
- `package.json`: Isolated test configuration.

