# Fixed synthetic GPU benchmark

Prepared for the user-authorized October12 RTX4090 experiment, with a USD1 total rental budget and30-minute maximum Pod lifetime. Preparation is local before rental. Results are not established merely by compiling this code.

This reuses BitCrack commit `6bf8059ef075eb1622298395866b0bd02375e1d9` under its MIT license. `../upstream-lock.json` identifies every original file. The adapter only accepts six built-in synthetic cases. There is no arbitrary target, secret-input file or puzzle71 mode.

`generate-vectors.mjs` uses Node/OpenSSL to derive compressed-address test vectors. Every case starts at2^40. Validation scans two complete batches, with positive probes at the first candidate, either side of a batch boundary, and the last candidate. Negative probes sit immediately before and after the interval. Timing cases scan `[2^40,2^40+2^35)` (34,359,738,368 candidates), using a positive probe at the final candidate and a negative probe at the exclusive end. These are public synthetic fixtures and must never be used for storing funds.

Three configurations:64blocks×256threads×64points,128×256×128,128×256×256. All sizes divide the fixed ranges exactly; there is no partial tail or uncontrolled overrun. Each configuration scans the same range. Do not add their counts as unique coverage. No puzzle71 work is credited.

The original CUDA point-stepping/hash/check kernel remains in use, with a device-side counter added after each block completes its work. Host code compares this with the exact expected count, checks returned matches against independent vectors and checks final next-key state. Timing uses a monotonic host clock around synchronous scanning calls. Initialization and complete-suite wall time are reported separately. This validates selected boundaries and counters, not every candidate independently, and is not cryptographic remote attestation. The fixed synthetic width is not proof of production correctness across every puzzle71 boundary.

Preparation:

```sh
node gpu/benchmark/generate-vectors.mjs
python3 gpu/benchmark/prepare.py VERIFIED_UPSTREAM NEW_BUILD_TREE
bash gpu/benchmark/build.sh NEW_BUILD_TREE CUDA_TOOLKIT OUTPUT/bithash-benchmark
```

Runtime package contains the binary, CUDA runtime library/license, vectors.json, run.py and a SHA256 file manifest. Run `python3 run.py` on exactly one RTX4090. It validates all configurations before timing any, records nvidia-smi utilization/temperature/power/clock/memory samples, writes partial evidence after each case and rejects unexpected output. Individual worker timeout190seconds; internal scan deadline180seconds; total-suite guard20minutes. These worker limits do NOT terminate cloud billing: the operator must stop/delete the Pod within the rental limit and confirm provider state.

Publish the build identity, original report, provider lifecycle/cost observation and any failures alongside the result. CPU compilation/test results alone cannot substantiate GPU throughput. The first local compile caught an ambiguous C++ uint64 constructor; explicit width casts resolved it before rental.
