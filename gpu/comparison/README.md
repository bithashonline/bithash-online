# EXP-006: GPU cost-efficiency comparison

Authorized October 12, 2026: RTX A5000, RTX 3090, RTX 5090 and a repeat RTX 4090, one at a time, USD2 total rental cap and at most30 minutes perPod. This is a controlled comparison, not a claim that the benchmark has already passed.

Same pinned BitCrack upstream, synthetic vectors and C++ worker as EXP-005. This separate source directory preserves the previous published experiment. A fat binary contains native SM86/SM89 and compute89 PTX for forward-compatible driver JIT on Blackwell. NVIDIA documents this compatibility path: https://docs.nvidia.com/cuda/blackwell-compatibility-guide/index.html . It is not a claim of optimal Blackwell native compilation. Driver/JIT differences and initialization times are recorded.

Prepare a fresh source tree with prepare.py, then build.sh using the verified CUDA12.4 toolkit. Package with package.py. Every case retains the same fixed synthetic public range and positive/negative probes. No arbitrary target input, wallet recovery or puzzle71 execution mode exists.

Run `python3 run.py a5000` (or `3090`, `4090`, `5090`) on exactly the expected single GPU. Three two-batch validation cases precede nine timing cases: each of the three profiles runs three times in rotating order. Every timing case scans2^35 candidates. Rank each GPU by its best profile's median candidates/second divided by its observed total hourly rental quote; retain minimum/maximum and initialization/end-to-end overhead separately. Repeated ranges are not distinct coverage, and model comparisons with overlapping variability may need additional testing.

Before work, launch `nohup python3 stop-watchdog.py > watchdog.log 2>&1 &`. The fallback uses only the provider-injected own-Pod ID and Pod-scoped API key, calling the official Runpod stop endpoint after20 minutes. It never prints credential values. This runs inside the Pod and is best-effort; it is not an independent budget guarantee. The operator still enforces the30-minute allocation limit and totalbudget, retrieves evidence and stops/deletes the Pod. Documentation: https://docs.runpod.io/pods/manage-pods and https://docs.runpod.io/pods/templates/environment-variables .

The worker is bounded to190seconds percase, with a950second suite admission guard; the final admitted case may extend past950seconds. Reports are rewritten atomically as JSON and mirrored to a .txt file for fast browser-editor copying. Final stdout prints the original reportSHA256 so the recovered bytes can be checked. Use a bounded retrieval operation; do not wait indefinitely on a browser download while billing continues.

Results require matching package hashes, all12 cases passing, explicit model and driver, provider lifecycle/billing observations, and privacy-reviewed reports/screenshots. Logs/counters are not remote attestation or proof of every scalar calculation. All allocation, build or test failures must be disclosed. No new recurring rentals are authorized.
