# Owned range solver connection — October 13, 2026

Implemented and tested locally. The previous live RTX 4090 run used the synthetic benchmark interface; it did not validate this new CUDA range binary or give puzzle #71 coverage. No production deployment, additional rental or #71 search occurred in this step.

The existing staging ledger `local/work/online-coverage/state.sqlite` now contains the new owned-range tables and one planned #71 job, `range-5e437720d9659af2aa70b351`. Its exact interval is `[1180591620717411303424,1180591620717412352000)`, or `[0x400000000000000000,0x400000000000100000)`: 1,048,576 candidates. Cursor equals start, epoch is zero, and no worker is enrolled. The four existing own-only policies and historical reports/checkpoints remain intact. A consistent pre-migration snapshot is retained privately in the October 13 chat's work directory. Planning reserves this range; it does not search it.

## Connection

`OwnRangeLedger` uses the existing Controller SQLite database, WAL, FULL synchronous commits and immediate transactions. It reserves disjoint exact intervals using BigInt, persists a chunk assignment before sending it, and advances only after receiving a valid Ed25519-signed receipt for that exact job, lease epoch, enrolled worker, provider Pod, solver checksum, interval and deadline. Receipt archival, chunk acceptance and cursor advancement share one transaction. An unassigned, incomplete, late, fenced or invalid receipt cannot advance coverage. Duplicate accepted receipts return an acknowledgment without adding credit or extending a lease.

`createOwnRangeServer` exposes only the scoped task/receipt paths and a sanitized read-only ledger projection. Production traffic requires HTTPS. The client verifies certificates/hostnames, follows no redirects, has bounded bodies and timeouts, and carries a per-lease capability; it never receives a provider API key or owner signing credentials. Enrollment is an operator-only method, absent from HTTP. The existing dashboard snapshot and coverage summaries read owned-range allocations/checkpoints from the same database; the deployed dashboard has not been updated.

`gpu/range/worker.mjs` runs a separate process with a strict private configuration. It pins the Linux binary checksum and invokes it without a shell or inherited environment. It saves and fsyncs a signed pending receipt before submitting it. Restart sends that receipt first; loss of an acknowledgment cannot cause duplicated credit. A dead process lock can be reclaimed, while a live process blocks concurrent execution. A crash during lock reclamation, PID reuse, unavailable state storage or an invalid lock can require operator recovery. Uncommitted GPU computation can be repeated after interruption; only accepted coverage is preserved. Host replacement needs the retained state or a fresh fenced lease.

The CUDA entry point accepts only #71 or the fixed synthetic high-bit probe. It accepts exact half-open intervals up to 2^32 candidates, hashes active compressed lanes only, checks a device-side count and the upstream next-key calculation, and returns one bounded result. It does not expose the upstream arbitrary-address CLI. Before fetching search tasks, the GPU worker runs three known-answer checks: positive single key, exclusive-end negative single key and a cross-batch/tail range. These checks produce no #71 credit and do not prove exhaustive search of all assigned work.

An apparent #71 match is independently checked and encrypted to an approval-bound RSA-3072 owner recovery public key. Native plaintext travels only through private FD3 into the wrapper; stdout contains no scalar. The ledger stores the encrypted candidate privately, pauses the target and leaves the candidate chunk uncredited. Public views omit its range and ciphertext. No prize was found; candidate-storage tests use synthetic ciphertext. Owner recovery material must remain outside any public source or GPU configuration.

## Run the local reproduction

Node 22.16 or newer; no npm dependencies:

```sh
node --test local/own-range.test.js
node local/own-range-demo.js /absolute/path/to/new-private-demo-directory
node local/own-range-cli.js /absolute/path/to/state.sqlite status
```

The demo performs nine actual Node/OpenSSL address computations around a known 71-bit probe, across three chunks, using a real loopback server and separate worker process. It reopens the database and emits public-key-verifiable evidence. Its private directory contains the test capability and ephemeral test signing key: do not publish that directory. The source package includes sanitized evidence, without those files. Reproduction on Windows needs normal subprocess, atomic rename and loopback permissions; sandbox-only execution encountered EPERM and blocked local transport, while normal execution passed.

## Activation still required

The current deployed real executor supports the benchmark mission only. `approvedRangeMission` is a prepared adapter for a trusted private executor snapshot containing a fresh exact `fixed-public-puzzle-range` mission; the current benchmark approval cannot authorize it. Production lease creation rejects by default unless an operator supplies a trusted synchronous approval verifier. Worker-supplied approved flags are insufficient.

Before live use: implement and deploy the range-aware proposal/bootstrap/archive integration; configure the owner's recovery public key and authenticated HTTPS ledger endpoint; obtain a fresh Google owner approval binding this job/range, binary checksum, recovery key, one Pod and a bounded rental/cost ceiling; run the new binary's GPU qualification; then execute/accept the approved range and verify provider cleanup. None of these remaining activation steps is represented as complete. The previous rental was deleted and its approval is not reusable.

Validation: 13 new range tests and all 187 backend tests passed. The CUDA build succeeded and 16 inspect-only native boundary/precision checks passed. A separate CPU worker completed/reopened three probe chunks. The new binary's GPU behavior, remote TLS deployment and the production range mission remain unvalidated. Authenticated worker receipts are evidence of a worker claim, not independent hardware or exhaustive-search attestation. Own #71 checkpointed candidates remain zero.
