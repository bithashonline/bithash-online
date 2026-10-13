# Architecture

The local dashboard connects Google owner authentication, bounded proposals and a mock executor. A separate Linux host runs isolated shutdown and reporting services. Shutdown holds provider credentials; the collector holds public worker enrollments and signed history. Workers receive only their own signing material and collector trust configuration.

The local dashboard validates collector TLS and proxies read-only progress/proofs. Closing the computer stops its UI and future local AI; remote worker reporting and registered-Pod shutdown remain independent. One host is a shared failure domain. See local/REMOTE-PROGRESS.md and ops/runpod-shutdown/HOSTING.md for operational limits. Automatic real dispatch, model inference, treasury funding, retention and live GPU telemetry acceptance remain unfinished.
