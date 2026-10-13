# Local dashboard
Source ships directly in public/ without a bundler. This release relocates the existing dist/ assets to public/ and updates static-server/test paths.

Run `node --experimental-sqlite server.mjs` from this directory; open http://127.0.0.1:4173. Test with `node --test *.test.mjs`.

Optional environment variables:
- BITHASH_BACKEND_MODULE: absolute path to ../local/dashboard-api.js.
- BITHASH_CONTROLLER_DB: private fixture controller database.
- BITHASH_APPROVAL_DB: private approval database.
- BITHASH_GOOGLE_SETUP_FILE: private setup JSON; see ../local/GOOGLE-OWNER.md.
- BITHASH_COLLECTOR_CONFIG: private JSON with HTTPS origin and caFile; see ../local/REMOTE-PROGRESS.md.

Install ../local dependencies first. Keep configuration and databases outside public/ and the repository. The server binds loopback only with a fixed origin. Public hosting needs separate HTTPS/origin/security configuration.

Browser simulation values, including the legacy 80% example, are fictional. Actual intended spending requires explicit owner approval per bounded run. Google sign-in does not sign treasury transactions. Collector proof cards are separate from simulation and CPU fixtures. No AI model is connected.
