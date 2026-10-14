# Owner recovery

The executor is a bounded, owner-approved public Puzzle #71 service. No GPU rental is needed to verify a backup. The recovery CLI never dispatches or approves work.

## Snapshot and verify

Run recovery.py snapshot with --executor, --shutdown, --collector, --config-dir and --destination pointing to owner-private paths. It refuses active or unresolved sessions, uses SQLite's backup API to include committed WAL records, checks database integrity, verifies that accepted coverage is unchanged and verifies an extracted temporary copy. The destination must not exist. Run recovery.py verify ARCHIVE to validate the manifest and database copy again.

Snapshots contain credentials and must stay private. The desktop packaging procedure encrypts the complete snapshot using Windows DPAPI CurrentUser and verifies decryption by digest. This requires the same Windows account and profile; it is not a portable backup after losing that profile. Retain the protected owner recovery recipient with the encrypted snapshot. Store any exported profile/key recovery material securely outside public repositories. Public signing keys and signed receipts cannot replace private owner recovery material.

## Manual restore

1. Keep the service offline and disable the executor and independent shutdown timers while investigating. Read the provider account inventory separately and reconcile every known or uncertain Pod before restoring. An old database is never proof that rentals are absent.
2. Decrypt the snapshot in an owner-only location using the original Windows profile. Verify it with recovery.py verify. Check the manifest, checkpoint totals and configuration paths. Keep the existing private files as a rollback copy.
3. Install the matching published executor, collector and shutdown code. With services stopped, restore the three database files from the verified archive and the corresponding private configuration, file ownership and 0600 permissions. Preserve all signing and recovery key bindings. Do not copy a database over a running SQLite connection or merge WAL files from another snapshot.
4. Verify SQLite integrity and the saved ledger. Confirm every restored session is terminal or unapproved. Reconcile provider inventory and shutdown lease state independently before enabling either executor dispatch or shutdown timers. Investigate any mismatch with both services disabled.
5. Start the read-only collector and inspect status. Start shutdown protection, then the executor only after inventory, keys, code pins and limits agree. A new rental still requires a fresh exact Google owner approval; do not replay an old approval to recover work.

The tested product release retains three completed assignments and 3,145,728 checkpointed candidates. These are authenticated worker claims, not independently attested exhaustive coverage. Recovery verification does not establish current provider billing or host availability. There is no automatic scheduled backup or unattended restore in this release.
