# October 13, 2026 — GPU fallback preference

User authorized fallback when A5000 is unavailable. New drafts use fresh Secure Cloud CUDA 12.8 catalog availability in order: RTX A5000, RTX 4090, RTX 5090. RTX 5090 is the additional previously benchmarked alternative, not an unlimited GPU selection.

The first available supported GPU supplies the bounded options. No supported capacity or no option within the spending cap holds. A model may select only the supplied option IDs or hold; it cannot invent hardware, extend runtime or approve spending. Exact GPU, quote and cap are bound into the owner-approved terms. If that GPU becomes unavailable after approval, dispatch rejects; it does not substitute another GPU under the old approval.

Validation: 23 relevant local planner/executor tests passed; the 19 executor fixtures also passed on the Linux host. Tests cover preference order, unavailable alternatives, malformed/duplicate catalog rows, cap enforcement, and approval-bound fallback with capacity loss. Initial sandbox run hit a Windows temporary-file rename restriction; the same suite passed outside that sandbox. No new model call or GPU rental was performed for this change. Fresh live fallback/archival acceptance remains pending owner approval.
