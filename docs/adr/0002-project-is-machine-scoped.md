# Project is Machine-scoped, not Account-scoped

A Project is identified by `(Account, Machine, path)`. The same git repository cloned on two different Machines produces two distinct Projects, each with its own Knowledge, Skills, Supervisor configuration, and Triggers.

We chose this because a Project's Knowledge and automation config are tightly coupled to the local environment — file paths, installed tools, OS-specific conventions, and Daemon capabilities differ per Machine. Merging them would require conflict resolution logic for environment-specific facts and risk applying one Machine's conventions to another.

**Considered alternative:**
- Account-scoped Projects keyed by `gitRepoUrl`, with Knowledge and Skills shared across Machines. Rejected because environment-specific Knowledge (file paths, local tool versions, OS quirks) would conflict, and the dedup logic adds complexity without clear user demand. Projects can still be loosely associated via `gitRepoUrl` for cross-Machine reference when needed.
