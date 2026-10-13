> CURRENT VALIDATION — October 12, 2026: the October11 Runpod RTX4090 pilot completed all14 cases successfully using binary4148dce03b6a5a0f7e688b77dc9b00f77190bb2902c1c37b7cb19835368febe6. Rental terminated/deleted; displayed credit useUSD0.07. This supersedes historical unvalidated-GPU statements below. This is small-fixture correctness only, not sustained throughput or large-range validation. See ../experiments/2026-10-11-rtx4090-pilot.md and ../experiments/results/2026-10-11-gpu-validation.json.
# Bounded CUDA fixture worker

October 7, 2026: compiled successfully in Ubuntu under WSL using workspace-local CUDA 12.4.1 components. Linux x86-64; SM 89 (RTX 4090). This is a fixture-validation binary, not a throughput-optimized search worker. **GPU correctness remains unvalidated.** The local machine has AMD graphics; its CUDA fixture run exited unsuccessfully without producing a result.

The executable accepts only `puzzle-1`, `puzzle-2`, or `puzzle-3` and exact subranges within each solved puzzle. The upstream BitCrack CLI is not included. No arbitrary target, fee wallet, provider key, payout, network client or checkpoint file is accepted. Its single bounded CUDA kernel hashes only active fixture lanes, checks a device-side attempt counter, and returns a match boolean and attempt count. Upstream elliptic-curve initialization still prepares a padded 32-lane batch. This is not a benchmark and does not prove production coverage or scaling.

## Source and build

Pinned upstream: [BitCrack commit 6bf8059](https://github.com/brichard19/BitCrack/tree/6bf8059ef075eb1622298395866b0bd02375e1d9). `upstream-lock.json` records the archive checksum and every unmodified source-file checksum. `prepare.py` verifies the tree and writes a new patched tree; it refuses an existing destination. Existing cryptographic implementations are reused. Changes add a tiny bounded kernel, a dedicated fixed-fixture entry point and silent upstream logging.

CUDA component URLs and SHA-256 checksums are in `cuda-components.json`, sourced from NVIDIA's [12.4.1 manifest](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_12.4.1.json). Extract the three verified component archives into one toolkit directory. No global install is required.

```sh
python3 gpu/prepare.py /path/to/verified-upstream /path/to/new-prepared-tree
bash gpu/build.sh /path/to/new-prepared-tree /path/to/cuda /path/to/package/bithash-fixture
```

The build uses a Linux host C++ compiler and Make. Place `libcudart.so.12` from the toolkit beside the executable in `lib/`; the binary uses `$ORIGIN/lib`. Include the upstream MIT and NVIDIA licenses. The produced package was built on Ubuntu 24.04; use that release or a compatible newer glibc/libstdc++ environment. A compatible NVIDIA driver and GPU are required for successful execution. No OCI image has been built or pushed, so this binary's checksum must not be used as a Runpod image digest.

## Verification

From an extracted package on an NVIDIA host:

```sh
python3 validate.py ./bithash-fixture
```

The validator runs all 14 contiguous subranges of the three fixtures, including ranges excluding a known solution. `reference-vectors.json` is checked against the independent Node/OpenSSL CPU implementation by the local test suite. Validation must exit zero with `gpuValidated: true`; a compile, launch attempt or partial result is insufficient. JSON excludes candidate keys and raw worker diagnostics. The report records the exact binary checksum. Keep the package and report together.

Observed locally: compilation/linking succeeded, runtime libraries resolved, six invalid-input invocations returned controlled failures, and 47 backend tests passed. No valid GPU fixture completed. No real fees, paid rentals or network worker execution occurred. Next: run this package on an authorized NVIDIA host, investigate any discrepancies, then build a digest-pinned container and integrate authenticated worker receipts. Controller GPU checkpoint credit remains disabled.

October 11 pilot validator update: now pins the recorded executable SHA256, requires a single host-reported RTX 4090, records driver and wall duration, and marks billing as unobserved. These metadata checks are not remote attestation. Local AMD failure path confirmed and two GPU corpus tests pass; all 14 GPU cases remain unrun. Current package is in the October 11 let-s outputs folder.

