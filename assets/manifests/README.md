# Provenance

- `builtin/`: reproducible committed receipts with source/output SHA-256 and pinned processing versions.
- `uploads/`: original filename/hash, runtime hash and optional source asset ID linking STEP to its derived GLB.
- `generated/`: provider/model/prompt/task/request hashes, processing tools and validator results.
- `plans/`: validated scene plans reused when interrupted asset generation resumes.
- `jobs/`: durable Tripo task ledger. API keys are never stored. A `creating` ledger without task ID is uncertain: find the task in the provider console, then resume with `--task-id`; do not delete it to trigger another paid submission.
- `worlds/`: world-generation request and compiled-scene hashes, asset manifest links.

Built-in receipts and the two repository example-world receipts are committed. Other CLI/user records are local data.
