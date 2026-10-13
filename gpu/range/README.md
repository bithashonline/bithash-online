# Fixed public-puzzle range binary

Local build, October 13, 2026. SHA-256: `2fa95f416407975c757497c9d4cc6c4e235211da8a5fa7ac44f20b4383d5e555`. This binary has not executed on a GPU. The prior live synthetic benchmark has a different checksum and protocol.

Sources reuse BitCrack commit `6bf8059ef075eb1622298395866b0bd02375e1d9`, verified against `../upstream-lock.json`, and the existing NVIDIA CUDA 12.4.1 component pins in `../cuda-components.json`. `prepare.py` refuses any missing, modified or extra upstream file and writes a new tree. It adds active-lane compressed hashing, a per-step device count, error checks and silent upstream logging. Cryptographic primitives remain the inspected upstream implementations.

```sh
python3 gpu/range/prepare.py /path/to/pristine-pinned-upstream /path/to/new-prepared-tree
bash gpu/range/build.sh /path/to/new-prepared-tree /path/to/cuda /path/to/package/bithash-range
mkdir -p /path/to/package/lib
cp /path/to/cuda/lib/libcudart.so.12.4.127 /path/to/package/lib/libcudart.so.12
```

Keep the upstream MIT and NVIDIA redistribution licenses with the package. The binary uses `$ORIGIN/lib`. The supplied build needs Linux x86-64, glibc >=2.38 and libstdc++ with GLIBCXX_3.4.32 (Ubuntu 24.04 or compatible), plus a compatible NVIDIA driver for actual scanning. SM86/SM89 and compute89 PTX are included. RTX 5090 depends on PTX JIT and remains untested. Rebuild for a different base image rather than silently using incompatible libraries. This is a file checksum, not an OCI image digest; no container was pushed.

CLI: `bithash-range scan|inspect puzzle-71|range-probe-71 START_DECIMAL END_DECIMAL`. Bounds are canonical exact unsigned decimal strings, `[start,end)`, restricted to `[2^70,2^71)` with span <=2^32. The probe namespace is further restricted to the first 2^32 values and its fixed synthetic address, with key `2^70+2^20+7`. Inspect mode parses arguments only and has no completion schema; it cannot supply a ledger receipt or claim work.

Native scanning has a 55-second guard; the parent imposes at most 60 seconds and the lease deadline. It rejects CUDA errors, unexpected counts, incorrect probe outcomes, out-of-range matches and wrong next-key progression. Padding is used for curve initialization/advancement but inactive lanes do not hash or count. A #71 candidate goes through FD3 only and stops the chunk. Use the provided worker wrapper, which validates/encrypts it and rejects stderr, oversized output, failed exits, expired work or mismatched binary pins.

Worker launch: `node gpu/range/worker.mjs /absolute/path/to/private-worker-config.json`. The private configuration and signing key are provisioned by the future range-aware operator after exact owner approval; never embed them in source or publish them. Node >=22.16, no external packages. See `../../local/OWN-RANGE-SOLVER.md` for protocol, tests, crash recovery and remaining production activation steps.
