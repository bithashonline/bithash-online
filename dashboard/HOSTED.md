# Hosted dashboard source

`public/` contains the currently deployed presentation, including the operator avatar and report renderer. `worker/gateway.mjs` protects embedded assets behind a server-side password gate; `worker/telemetry.mjs` provides the fixed read-only reporting proxy.

Build with `npm run build` from this directory. The output is `dist/server/index.js`; the build contains no runtime credentials. `.openai/hosting.json` intentionally omits the private hosting project identity. Set up your own Worker deployment and runtime environment separately.

Required private environment: `BITHASH_PASSWORD_VERIFIER` (JSON with 100000 PBKDF2 iterations, a 32-character hex salt and a 64-character hex hash), `BITHASH_SESSION_SECRET` (at least 64 characters), and `BITHASH_TELEMETRY_READ_TOKEN` (64 hex characters matching the read bridge). No actual values are supplied in this repository. Unconfigured services fail closed. This source retains the BitHash telemetry hostname; forks must configure their own bridge.

The loopback `server.mjs` remains a separate local approval/simulation backend. The deployed hosted operator view reads the remote bridge and cannot approve runs. Do not infer hosted approval support from the local server.

The graphite/amber pixel-art avatar (`overseer-v2.png`) was generated for BitHash. The deployed artwork and hosted rendering source match Sites v12; no GPU status is inferred from the character artwork.
