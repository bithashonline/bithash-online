# Runpod v2 catalog and deployment staging — October 12, 2026

Local implementation only; no new rental, credit purchase or provider mutation.

## Observed provider evidence

Authenticated Runpod MCP catalog read at 22:30:00.825 UTC, Secure Cloud, Pod product, count=1, minimum CUDA=12.8. Saved selected catalog fields: [source observation](evidence/2026-10-12-runpod-catalog.json).

| GPU | Compute list price / GPU-hour | Observed stock |
|---|---:|---|
| RTX A5000 | $0.27 | NONE |
| RTX 4090 | $0.89 | MEDIUM |
| RTX 5090 | $1.19 | LOW |

These are dated catalog rates, not all-in quotes, reservations, free-GPU counts, invoices or performance measurements. They exclude storage and shutdown headroom. No current stock guarantee. API contracts checked against the [official v2 OpenAPI specification](https://api.runpod.io/v2/openapi.json). The query parameter is `count`, not `gpuCount`.

## Implemented

- `local/runpod-v2.js`: GET-only API client with fixed HTTPS origin, timeout, rejected redirects and sanitized failures. Normalizes selected GPU fields, strips unknown properties and hashes the normalized record. Client transport exercised with injected responses; actual observation obtained through MCP, not this new client's credential path.
- Fixture deployment request preparation validates GPU/count, 60-second quote age, 30-minute maximum runtime, image digest syntax and disposable disk limits. Binds request, duration and catalog digest; computes rounded compute-only estimate. No actual image has been published or verified by this step.
- Staging always returns `deployable:false` and a null all-in cap. The module has no create/stop/delete operation. It is preparation for an executor, not a live executor.
- Dashboard endpoint `/api/approvals/provider-catalog` serves the saved observation and its normalized SHA-256. UI labels age, scope and limitations, links evidence, and keeps mock pricing separate. Local panel polling does not refresh the provider snapshot.

A SHA-256 establishes record consistency, not provider authorship, immutable publication or evidence of GPU computation. Saved evidence is editable local data. No request staging result is accepted as an owner spending approval.

## Validation and remaining work

101 backend tests and 15 frontend tests pass. New cases cover stale and modified observations, unavailable GPUs, mismatched GPU counts, unpinned images, transport failure redaction, fixed read-only requests, safe HTML and explicit pricing limitations. Browser verified the new panel and linked endpoint. Restarting the local preview cleared its memory-only Google session; user can sign in again. Existing mock executor remains separate.

Remaining: independently hosted and verified shutdown controller; v1/v2 lifecycle compatibility; a published fixture worker image and live receipt transport; all-in reservation policy; owner approval binding the full provider payload and shutdown lease; durable dispatch, orphan discovery and reconciliation after ambiguous creation. Paid acceptance requires a separate exact spending cap and test. Nothing in this change enables live deployment. No public GitHub push was performed.
