# Release 1.0.2 Checks

Date: 2026-11-04. Product: Review Tools for GitLab.

## Scope

- Automatic exact-commit worktree preparation on MR selection/expansion in trusted workspaces.
- Stable tree identities, unchanged-model reuse, filtering of worktree-only refreshes, shared
  version loading, and selected-MR retention/restoration across an extension-host restart.
- Existing cache maintenance and local-data protections remain covered by regression tests.

## Validation

- Jest: 302 suites / 2733 tests passed. Real VS Code integration: 31 tests passed.
- Packaging and third-party notice checks: 7 tests passed. TypeScript no-emit, scoped ESLint,
  Prettier, and Git whitespace checks passed.
- Unit tests cover selection/expansion deduplication, trust restrictions, rapid MR switching,
  restoring the selected MR rather than the first MR, retaining selection while hidden, releasing
  selection on project/query rows, and suppressing refreshes for excluded worktrees.
- A real VS Code TreeView integration test expands an MR, checks that its exact Git worktree is
  created automatically, disposes and recreates the view/controller with saved state, and verifies
  restoration of the same MR with no duplicate worktree or original-branch switch.
- That integration uses controlled GitLab responses and real project/query/MR model classes. It
  exercises the VS Code API boundary, not physical mouse clicks or a real extension-host restart.
- Existing real TypeScript and Go/gopls navigation, hover, MR comment-range, and cache-cleanup
  integration tests are also included.
- The test-only preparation view is injected into the generated integration-test manifest and
  excluded from the release package by its clean rebuild.

## Limits and release checks

- VS Code can still restart extensions when first converting a single-folder window to a
  multi-root workspace. Saved-state restoration is conditional on the MR still appearing in the
  same query/project after restart; authentication changes or unavailable GitLab data may prevent it.
- Automatic preparation requires workspace trust. Loading query lists alone does not create
  worktrees, and mouse hover alone does not create or attach a workspace.
- Language services still need indexing time and the repository's dependencies/build configuration.
- Source history and final VSIX are checked with Gitleaks, with only exact upstream dummy sanitizer
  tokens allowed in their test fixture. The VSIX retains MIT attribution and third-party notices.
- The dependency lockfiles change only in package version metadata. This release does not claim
  to remediate the existing repository dependency advisories documented in 1.0.1's release checks.
