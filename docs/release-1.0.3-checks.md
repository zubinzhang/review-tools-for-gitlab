# Release 1.0.3 Checks

Date: 2026-11-09. Product: Review Tools for GitLab.

## Scope

- Add commit history under each MR and first-parent file comparisons within the native VS Code diff.
- Use GitLab REST MR commits and repository commit diff endpoints with project ID, MR IID, full
  commit SHA, and explicit pagination. No extra request is made while only opening an MR's file list.
- Separate commit comparison URIs from overall MR review URIs. The comment range provider and
  comment submission reject commit comparisons, including a commit equal to the current MR head.
- Historical comparisons do not use current-MR semantic navigation or viewed-file tracking.

## Verification

- Jest: 303 suites / 2749 tests passed.
- Real VS Code integration: 32 tests passed. The added integration browses MR → Commits → files
  through the real data provider and REST mocks, executes the file's diff command, verifies both
  document contents and SHAs, and checks that MR comment ranges are absent from the comparison.
- Unit coverage includes lazy loading, concurrent expansion, pagination of commits and files,
  distinct tree IDs, author/message display, first-parent merge comparisons, initial commits,
  additions/deletions/renames, failed-request retry, invalid SHAs, and historical-document guards.
- Existing TypeScript and Go/gopls navigation, workspace preparation/restoration, cache cleanup,
  and MR discussion tests remain in the integration suite.
- Packaging/license tests: 7 passed. TypeScript, scoped ESLint, Prettier, and whitespace checks
  passed. The final VSIX contains the updated changelog and no integration-only test view.

## Limits

- GitLab API responses were mocked for this feature's tests; no private live MR was modified.
- Commit list membership follows the current MR state, not a historical diff-version snapshot.
  Refresh after a force push. Opened file comparisons remain pinned to their full commit SHAs.
- Merge commits compare against the first parent. Pagination does not bypass server diff limits;
  binary or omitted diff text may need inspection in GitLab.
- Tests exercise the actual VS Code diff API and providers, not physical mouse interactions.
- Dependency versions are unchanged. Existing repository dependency advisories described in
  earlier release checks are not remediated by this feature.
