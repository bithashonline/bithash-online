# Hosted GPU reporting acceptance — October 13, 2026 UTC

One sponsored Runpod Secure Cloud RTX 4090 completed the fixed synthetic validation and benchmark, sent signed reports to the independent collector, appeared at https://bithash.online/#gpu-progress, and was automatically stopped and deleted by the independent deadline controller. A second, deliberately interrupted run reported an error without crediting its unfinished benchmark. **Puzzle #71 candidates checked: zero.**

## Outcome and evidence

- [Completed result](artifacts/hosted-gpu-acceptance/result.json): 2 cases passed; 34,361,835,520 reported candidates across overlapping synthetic ranges. The benchmark averaged 1,367,062,971.69 candidates/s over 25.134 seconds; this is a case average, not an instantaneous rate or unique coverage.
- [Interrupted result](artifacts/hosted-gpu-acceptance/interruption-result.json): SIGTERM after 8 seconds; overall status `failed` as expected. Only the completed 2,097,152-candidate validation was credited. The unfinished benchmark contributed zero.
- [13 signed reports](artifacts/hosted-gpu-acceptance/proofs.json): eight successful-run reports and five interruption-run reports. All Ed25519 signatures and SHA256 payload digests verified. Two computing samples reported 97% utilization. Final normal state was idle; interrupted state was error. The website subsequently marked reports stale and then expired. These are authenticated worker claims, not independent hardware or search-coverage proofs.
- [Shutdown audit](artifacts/hosted-gpu-acceptance/shutdown.json): stop accepted at 02:26:14.517Z, delete accepted at 02:26:21.140Z, provider absence observed at 02:26:27.274Z. Controller timestamps identify the operation's audit tick, not an independently timestamped provider receipt. A separate native provider GET returned 404 and the account Pod list was empty. The temporary account SSH key was removed after deletion.
- The hosted dashboard's top panel incorrectly retained the old zero-GPU placeholder even while the GPU-progress section showed reports. This was corrected to unknown rental status with a direct link to signed reports. Live rental inventory synchronization is still unfinished.

## Configuration and reproduction

Provider Pod `17jsao96984h9q`, one RTX 4090, EU-RO-1 Secure Cloud, image `runpod/base:1.0.2-ubuntu2404`, 20 GB disposable container disk, no persistent mounts, Node 22.23.3. Host-reported NVIDIA driver 580.126.20; device name NVIDIA GeForce RTX 4090, 24,564 MiB reported memory. No provider or treasury credentials were installed on the worker.

The [matching supervisor source](../gpu/worker/) and [manifest](artifacts/hosted-gpu-acceptance/manifest.json) are included in this release. Its README is retained byte-for-byte as packaged, including its pre-test acceptance checklist; this dated record supersedes the pending-test wording. Build identity `sha256:17e6a74ec89099ef934493871b380ae52fac22a67611b667849f132ab8b4021b`; transferred archive SHA256 `598d0d4acf2b22139e2968eafd610a9912465abdb60a42660c8dda86eea5da63`. Archive metadata can vary; compare the exact file manifest/build. Rebuild using the README's pinned historical comparison archive. Local supervisor suite: 12/12 passing. Run `node experiments/verify-hosted-gpu-acceptance.mjs` to verify archived signatures, bindings, counters and shutdown ordering without renting hardware.

Successful lease `232fc8e9dcb67c7a87be53c6fb2e9072`; interrupted lease `7cff48c3db07600d1555c42654ad4b75`. Both expired at 02:25:10.074Z. Each public proof is available behind the website's existing preview password at `/api/gpu-proof/<digest>`; the archive includes the same public envelopes and verification keys without requiring preview access.

## Cost and limits

Approved ceiling: USD 0.30 and 15 minutes including setup. Quoted compute: USD 0.89/hour. Conservative rental start 02:12:10.074Z, deadline 02:27:10.074Z, shutdown headroom 60 seconds. Observed absence after approximately 14m17s implies about USD 0.21–0.22 including a small disk allowance; **this is an estimate, not a settled invoice**. The first provider billing read returned no records, which does not mean the test was free. Final billing reconciliation remains pending.

This proves a bounded synthetic integration with manual provisioning: GPU supervisor → authenticated collector → hosted report/proof → independent scheduled shutdown. It does not prove production puzzle search, restart/resume, nonoverlapping distributed ranges, automatic owner-approved real dispatch, treasury payment, AI operation, high availability, or fleet scale. One independent server remains a shared failure domain. Partial scanner work is deliberately discarded from credited counts. A fresh reporter enrollment is required for another run; this test did not extend any rental or restart a used lease.
