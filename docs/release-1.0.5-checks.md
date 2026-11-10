# Release 1.0.5 Checks

Date: 2026-11-10. Product: Review Tools for GitLab.

## Scope

- Reuse the MR review file item presentation for individual commit changes.
- Keep language icons, change-status decorations, A/M/D/R badges, and directory/list path
  descriptions consistent between **All commits** and individual commit selections.
- Remove the duplicate change type and full path text from commit file rows. Commit comparisons
  remain read-only and continue to use the selected commit and its first parent.

## Verification

- Jest: 303 suites / 2761 tests passed.
- Real VS Code integration: 33 tests passed, including list and directory layouts, exact commit
  comparisons, selection refreshes, and restoration of the overall MR view.
- Packaging/license tests: 7 passed.
- TypeScript production build, scoped ESLint, Prettier, and whitespace checks passed.
- Final VSIX: 33 files, 667448 bytes, extension ID `zubinzhang.review-tools-for-gitlab`, version
  `1.0.5`. The package contains the updated changelog and no source maps, test sources, test
  dependencies, integration-only view, or local filesystem paths.
- VSIX SHA-256: `c5375103c45d8b3541df6a19801e13b3cb57015847f81a41a642c7ec5cf02d83`.

## Limits

- GitLab responses are mocked in the automated tests. The tests exercise the real VS Code tree,
  provider, and diff APIs but do not simulate physical mouse interactions.
- Commit comparisons remain read-only. Use **All commits** for MR comments, viewed-file tracking,
  and worktree-backed semantic navigation or hover.
- GitLab diff limits and binary-file omissions still apply; use **Open commit in GitLab** for the
  complete server-side view.
