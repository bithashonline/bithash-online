# Two-Pod owned-range fleet

The initial fleet supports exactly two separate one-GPU Runpod Pods, one fleet at a time. An owner-triggered quote reserves two distinct Puzzle #71 assignments from the local ledger, resuming eligible unfinished assignments before selecting fresh ranges. Reservations are idempotent; a quote does not rent anything.

The fleet proposal binds both child term digests, fixed solver/image/bootstrap/recovery pins, resume checkpoints, GPU selection, total ceiling, rental duration and partial failure policy. One fresh Google owner approval authorizes that exact parent digest. Child approvals inherit the parent event and cannot be independently approved. The Operator only selects a supplied bounded quote; it cannot dispatch, approve or change GPU count.

Each Pod receives floor(total ceiling / 2) microUSD. An odd microUSD remains unused. The dispatcher rechecks availability and price before each create. Both members use the same start timestamp and deadline, so starting the second Pod cannot extend the rental. The independent shutdown service registers and stops each exact member separately. An unrelated account Pod blocks creation and is never adopted or stopped.

A committed creating state is written before the single provider POST. A rejected create drains known members. An unknown outcome is held for exact inventory reconciliation, cancels unstarted siblings and never repeats that POST or buys a replacement. An empty inventory is not proof that creation failed. A later unique matching Pod is adopted only for cleanup. Unresolved or private-review fleets block subsequent rentals.

Worker tokens, Ed25519 signing keys, leases and range capabilities are separate for each member. Receipts require exact job, epoch, span and identity; replay cannot advance coverage twice. Qualification, signed archive and completion are checked per Pod. The fleet finishes only after both independent deletion observations. Successful checkpoints are retained for a later freshly approved resume.

Public cards display the aggregate ceiling, estimate, per-Pod slices, exact ranges, shared deadline and separate progress. The public Site is read-only; propose, approve and stop require the existing same-origin Google owner console. Provider invoicing remains unreconciled until billing evidence is available. The operational ceiling is not a provider-enforced hard cap, and API failures may delay deletion.

Fleet tests use a mocked provider and signed fixtures. Passing tests or deployment does not establish physical two-GPU acceptance, sustained solver speed or independently verified exhaustive coverage. A real acceptance requires fresh Google approval for its exact fleet terms.
