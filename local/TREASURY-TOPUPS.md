# Treasury to Runpod: payment feasibility

Observed October 12, 2026. Read-only inspection plus an unpaid checkout session. No payment, wallet connection, account creation, auto-pay enablement or secret retrieval.

## Observed account checkout

Runpod Billing offered Pay with crypto. A USD10 checkout opened Crypto.com Pay, naming RunPod as recipient and requesting a QR scan in the Crypto.com app. No external-wallet or Solana-address option was visible. The checkout was left using its back arrow, without paying. This establishes the route shown for this session; it does not prove every Runpod account or payment route is identical. Do not publish the checkout URL, QR code, payment ID, card details or account receipt links.

## Documented capabilities

- https://docs.runpod.io/accounts-billing/billing documents processor-based cryptocurrency payments and saved-card auto-pay; prepaid credits are non-refundable.
- https://pay-docs.crypto.com/ documents merchant API authentication with merchant secret keys. The onchain_allowed setting belongs to merchant payment creation; our Runpod customer key does not grant control over Runpod's merchant checkout. Creating a BitHash merchant account would not grant access to Runpod's invoices.
- Connected Runpod tools expose billing reads but no payment/top-up tool. No supported customer invoice/payment API was verified.

## Implementation boundary

Automatic treasury SOL to Runpod credit is blocked on a verified provider payment interface, not on the ability to sign a Solana transfer. No live signer or fabricated direct-deposit adapter was added. Do not send SOL to a processor address inferred from a QR, invent a deposit address, rewrite checkout flags, or assume a completed onchain transfer means Runpod credited the account.

The eventual adapter must retrieve an authenticated invoice tied to our provider account, asset/network, recipient, exact amount, expiry and invoice identity. Owner approval must bind those terms plus network/conversion fees. Persist intent before signing, record the transaction identity before broadcast, reconcile unknown outcomes before retrying, and require successful finalized chain verification plus attributable provider credit before making funds spendable. Balance deltas alone are insufficient when concurrent compute charges occur. Treasury SOL, payment in flight, provider USD credit and consumed USD must remain separate balances. The model receives no private signing keys.

Each dashboard event needs a stable operation ID, actor, timestamp, action, approval reference, status and sanitized evidence reference. Include rejected attempts, timeouts, retries and unresolved reconciliation. Onchain evidence, provider observations and model summaries must have different labels. No live event feed or new payment executor was implemented in this inspection.

## Next external requirement

Confirm with Runpod whether customers can request a supported externally payable invoice and query attributed payment settlement programmatically. If not, current viable route is human Crypto.com checkout or owner-configured card funding while AI manages approved GPU runs. A direct treasury-to-provider autonomous integration cannot yet be promised.

Unsent support draft:

We are building an owner-approved GPU funding controller. Your crypto checkout currently directs us to the Crypto.com app. Do you offer a supported customer API for creating top-up invoices and querying payment/credit status? Can invoices be paid from an external Solana wallet in SOL or USDC, and what network, amount, expiry, account attribution and idempotency rules apply? We need confirmation of the supported integration, not merchant credentials or private checkout endpoints.
