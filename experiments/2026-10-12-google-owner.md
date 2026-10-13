# Google owner sign-in

October12, 2026. Local implementation; not activated, published or verified with a real Google login.88 backend/14 frontend tests passed; authentication tests use an injected verifier. Official google-auth-library installed with package lock; install reported zero known dependency vulnerabilities.

User chose Google identity for commands independently of developer/treasury wallet. Dashboard replaces Phantom approval controls with Google Identity Services login, sign-out and exact-term approval. No Gmail inbox permissions, wallet keys or transaction signing. Native SOL proof links remain separate.

Server uses google-auth-library verifyIdToken with the configured audience. Additional checks enforce issuer, expiration, verified email and exact immutable Google sub allowlist. No first-login-admin or email-only enrollment. Random HttpOnly SameSite=Strict session cookie,30-minute maximum bounded by token expiry, CSRF token plus exact Origin on mutations, logout revocation and restart invalidation. Secure cookie on HTTPS; current local server is fixed to http://127.0.0.1:4173. Tokens stay out of logs and database; session storage is memory-only and bounded. Google-owner audit evidence omits personal identifiers and records exact approved digest. It is a server assertion, not a wallet signature or onchain proof.

Activation requires a Google OAuth web client configured for the exact authorized JavaScript origin, BITHASH_GOOGLE_CLIENT_ID and BITHASH_GOOGLE_OWNER_SUB. GIS ID-token flow needs no client secret. Obtain the intended owner's sub from a server-verified token in a trusted setup process, not unverified JWT decoding. Do not paste Google ID tokens into chat. BITHASH_APPROVAL_DB and BITHASH_BACKEND_MODULE remain required for approval operations. New Google-mode databases bind owner as google:SUB; existing wallet-bound databases reject silent owner replacement. Preserve old records and initialize a separate Google-mode ledger when changing auth mode. Treasury wallet can remain unset. Restart local server after configuring it.

Unconfigured sign-in fails closed and shows setup required. Missing client ID or owner identity grants no command access. Historical wallet support remains in backend for existing ledgers but no longer appears as the command UI. No real Google account, client registration or owner ledger migration was performed.

Before hosting: HTTPS origin configuration, request rate limits, deployment-level security review, actual browser login acceptance and owner recovery process. Public evidence endpoints contain no Google email, token or subject.

Reference: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

### Follow-up: first-owner enrollment
Real Google web client created with user authorization. One-time exact-Gmail verified enrollment and private immutable-sub persistence implemented; persistence failure grants no session. Wrong account/claims, corrupted identity, overwrite and restart behavior tested. Backend91/91 and frontend14/14 pass. Real GIS sign-in button observed in local preview; live token verification and authenticated browser approval remain pending user login. No secret retained and no public deployment.

### Browser verification
User completed real Google login. Dashboard confirmed owner session; agent operated one mock approval test using synthetic funds. State changed proposed to reserved; event3 contains exact digest, google-session authorization and USD0.25 synthetic reservation. Evidence: [browser approval record](evidence/2026-10-12-google-browser-approval.json). This test is not human authorization for a paid run, provider proof or onchain evidence. No real spending. Local-only record.
