# Dashboard and owner console

Shared assets live in public/. The hosted Site uses public/index.html and public/app.mjs with read-only controls. Run node --experimental-sqlite server.mjs on loopback for the local console. When BITHASH_EXECUTOR_CONNECTION is configured, the server overlays the three owner/ entry files and retains shared assets from public/. This keeps Google sign-in and owner controls local.

Set BITHASH_BACKEND_MODULE to the absolute local/dashboard-api.js path, BITHASH_EXECUTOR_CONNECTION to private pinned SSH connection JSON (sshTarget, keyFile, knownHostsFile), BITHASH_GOOGLE_SETUP_FILE and BITHASH_APPROVAL_DB to private owner setup/storage, and BITHASH_COLLECTOR_CONFIG to existing HTTPS origin/CA configuration. Keep all configurations, keys and databases outside this repository. See local/GOOGLE-OWNER.md and PRODUCT.md. The fixed read-only owner evidence bridge retains its hosted read credential on the host and never forwards browser credentials.

Start the local ChatGPT Operator connection separately using local/chatgpt-operator-server.js and its existing private account directory. No model requests are made by page polling. Simulation is optional and clearly separated. Token treasury and automatic wallet funding are not connected.

Tests: node --test *.test.mjs from dashboard; Node 22 or newer with built-in SQLite is required for backend tests. The hosted worker must preserve its existing password gate, secrets and fixed authenticated read bridge. Do not publish private owner settings or backup archives.
