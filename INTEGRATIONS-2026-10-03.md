# Environment and integration inspection — October 3, 2026

## Direct local observations

Node v22.16.0 at C:/Program Files/nodejs/node.exe; Git at C:/Program Files/Git/cmd/git.exe. Python executable not found by Get-Command. Node crypto uses OpenSSL 3.0.16. Experimental node:sqlite works with SQLite 3.49.1. No installed package dependencies needed. `nvidia-smi` and `nvcc` absent from PATH; this does not prove no GPU/driver exists. Win32_VideoController CIM query returned Access denied. GPU identity/driver compatibility remains unknown. No attempt to inspect unrelated accounts or credentials.

Enabled tool inventory contains no Runpod, Vast or Solana fee connector. Available browser/web tools permit public documentation inspection. No provider account connection or payment instrument verified. No rentals or provider mutations made.

## Documentation observations, not executed integration

Pump official current [creator fee sharing instructions](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md): `create_fee_sharing_config` initially gives creator 10,000bps; current `update_fee_shares_v2` distributes pending fees under current shares, replaces final shareholders and sets admin_revoked. Nonempty, max 10, unique recipients with positive shares totaling 10,000bps. Permissionless AMM sweep and distribution are separate steps. This makes incoming sharing plausible; no signed transaction, deployed configuration or atomic launch/routing verified here. Agency's older instruction naming is not a current SDK specification.

[Runpod billing](https://docs.runpod.io/accounts-billing/billing) and [create Pod API](https://docs.runpod.io/api-reference/pods/POST/pods): prepaid credits, per-second compute/storage, card and processor-mediated crypto payments with required KYC before first crypto payment. Credits are nonrefundable; network storage may keep billing after Pods stop. Documented $80/hour account limit is not an agreed project budget. API endpoint exists; account eligibility, exact compatible GPU quote, workload acceptability, stable reconciliation and shutdown behavior untested. No assumption of native SOL invoice payment.

[Vast billing](https://docs.vast.ai/guides/reference/billing) and [create-instance API](https://docs.vast.ai/api-reference/instances/create-instance): prepaid marketplace credits with Stripe cards and BitPay/Crypto.com crypto paths. Compute, storage and bandwidth require full quote capture. Stopped storage continues billing; saved cards can cover negative balances. Most unspent credits can be refunded by request; spent credits cannot. No connected account, eligible quote, API idempotency/reconciliation or workload authorization established. Early stale documentation paths failed; current guide path resolved.

[BitCrack upstream](https://github.com/brichard19/BitCrack): MIT license, CUDA/OpenCL implementations, keyspace/stride/checkpoint options. README lists VS2019/CUDA10.1 and explicitly warns experimental OpenCL critical bugs on AMD/Intel. Current maintenance, modern-device compatibility and boundary/checkpoint semantics have not been independently established. It is a candidate for inspection, **not selected, installed or validated GPU software**. Local implementation uses established Node/OpenSSL crypto as a fixture-only correctness reference instead.

## Target and fixture evidence

[Public puzzle corpus](https://raw.githubusercontent.com/roadhero/Bitcoin-Puzzle-Info/main/BTC-Solved-Unsolved.txt) retrieved and #1–3 public address/scalar vectors matched locally. Half-open fixture ranges are [1,2), [2,4), [4,8). Seven total fixture candidates; demo #3 covers four.

btcpuzzle.info public list opened but extracted content omitted target data. Blockstream web/API request failed; direct Node HTTPS fetches to Blockstream and mempool.space address endpoints both returned fetch failed. No fresh #71 chain funding, spending, public-key availability or unsolved status established. The saved 7.1019168 BTC observation remains historical. Do not choose a production algorithm from absent public-key evidence. No #71 candidate search started.

## Comparison lessons applied

Agency architecture remains documentation-only inspiration, not verified backend/security. Cobweb's initial no-sweep snapshot and later matched sweeps show why timestamps matter; treasury receipts and run deductions still did not prove provider settlement. WWW's matched fee claim plus ordinary wallet custody similarly leaves downstream billing/operator powers distinct. Their public activity and WWW market outcome do not prove sustainable compute economics or predict this project's outcome.

The demonstrator therefore labels fee funding/invoices as synthetic, counts local fixture checkpoints separately from real payments, retains ambiguous liabilities and makes no fee→rented-GPU execution claim. No build score assigned under SCORING.md; adoption, financial integration and security evidence are missing.
