# Release 1.0.4 Checks

Date: 2026-11-09. Product: Review Tools for GitLab.

## Scope

- Replace nested commit file lists with selectable **All commits** and individual commit entries.
  Both choices update the same MR file tree, in directory or list mode.
- Show the active selection and refresh only the affected MR. Reuse the loaded commit list and
  combine commit diff pages, stopping and deduplicating repeated server pages.
- Preserve overall MR comments and viewed-file state when switching back to **All commits**.
- Ignore late responses after switching selections, share concurrent overall MR loads, and allow
  failed selections to be retried without displaying the overall MR files as commit changes.

## Verification

- Jest: 303 suites / 2759 tests passed for the final feature implementation.
- Real VS Code integration: 33 tests passed. The commit selection scenarios cover both directory
  and list layouts, execute registered selection commands, verify that only the selected MR emits
  a refresh, open exact first-parent diffs, and restore all files and viewed state.
- Unit coverage includes selection indicators, lazy commit loading, retry, duplicate diff pages,
  rapid selection changes, concurrent requests, and preserving a single comment controller.
- TypeScript, scoped ESLint, Prettier, and whitespace checks passed for the feature implementation.
- Packaging/license tests: 7 passed again for the 1.0.4 release. The production build passed;
  the final VSIX contains 33 files (667256 bytes) with the correct version, updated changelog,
  required notices, and no source maps, integration test view, test dependencies, or local paths.
- Release metadata formatting, whitespace, lockfile versions, and the VSIX SHA-256 were checked.

## Limits

- GitLab responses are mocked in the automated feature tests. Tests exercise real VS Code APIs
  and providers; they do not simulate physical mouse interactions or modify a private live MR.
- Individual commits remain read-only comparisons against their first parent. Use **All commits**
  for MR comments, viewed-file tracking, and worktree-backed semantic navigation or hover.
- Commit lists are cached until the sidebar is refreshed. Refresh after rebasing or force-pushing.
- GitLab server diff limits still apply; use the commit's GitLab page for omitted details.
- Dependency versions and the extension ID remain unchanged.
