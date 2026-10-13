# Live rental panel — October 12 Toronto / October 13 UTC

The top fleet panel now reads actual provider status for Pods registered with BitHash's independent shutdown controller. It joins each rental to the latest signed GPU report by provider Pod ID. No GPU was rented for this update.

The read-only server polls fixed Runpod GET endpoints approximately every 20 seconds, sanitizes the response and serves `/api/fleet-status` through the existing authenticated HTTPS bridge. The hosted preview password remains required. Browser polling is every 10 seconds. Unknown requests, unauthorized callers and writes are rejected. Provider credentials stay on the existing server; they are not placed in the website, worker or public repository. The service uses the existing controller credential, whose provider permissions include mutations, but this reader implements GET only. Its process does not modify shutdown leases or stop/start resources.

The count covers **registered BitHash Pods**, not every resource in a Runpod account. Provider 404 means deleted; 401, 403, 429, 500 and malformed responses mean unknown. Observations older than 45 seconds, future timestamps or failed requests cannot become a zero count. GPU counts come from the provider, while computing activity requires a matching fresh worker report younger than 30 seconds with an unexpired enrollment. Worker reports remain authenticated claims, not exhaustive search proof. Provider observation links expose the current sanitized observation, not a signed historical receipt or invoice.

## Validation

- Live provider reads confirmed both registered test Pods deleted. The published top panel displayed 0 running GPUs and retained historical report/proof links. The last worker error belongs to the deliberately interrupted acceptance run.
- All 32 hosted frontend/gateway tests passed, including five saved-report fleet tests and the new fleet proxy access test. Three server reader tests passed.
- Saved acceptance reports exercised deleted-rental history, running rental with stale reports, explicit computing replay, disconnection, future/stale timestamps, malformed/duplicate inventory and escaped labels/links.
- A local browser replay displayed one running RTX4090 using saved report values and explicitly fictional fresh timestamps/provider state. Its banner identified it as replay with no GPU rented. This replay was never published as current evidence. The preview process was stopped after inspection.
- HTTPS bridge returned 200 for authorized GET, 401 without authorization, 405 for POST and 400 for arbitrary queries. Existing shutdown, collector and nginx services remained active. No additional public port was opened.
- Hosted version 10 was published and browser-checked at https://bithash.online/#fleet. Public preview access remains password protected.

Source: [reader and service](../ops/fleet-reader/), [fleet renderer](../dashboard/public/fleet.mjs), [saved-report tests](../dashboard/fleet.test.mjs), [hosted proxy](../dashboard/worker/telemetry.mjs).

Run `node --experimental-sqlite --test ops/fleet-reader/fleet-reader.test.mjs` and `node --test dashboard/fleet.test.mjs dashboard/telemetry.test.mjs`. No provider credential or rental is required for these tests.

Limits: the live integration was checked against deleted rentals; running status rendering used a labelled replay, not another paid acceptance. GPU model/count are unknown after a fresh provider404 because no durable provider metadata archive is implemented yet. The current history labels are designed for the existing test rentals. Inventory over 100 registered entries fails unavailable rather than silently truncating. Durable status/proof archiving and larger-fleet scaling remain follow-ups.
