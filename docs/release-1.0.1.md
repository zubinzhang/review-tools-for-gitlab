# Review Tools for GitLab 1.0.1

Review worktrees no longer duplicate your repository list, and prepared snapshots are reused
across workspace removal and the extension ID change.

- Hide both current and legacy review caches from the MR project tree.
- Deduplicate folders for the same repository, MR, and full commit; retain different revisions.
- Detach idle workspaces after 30 quiet seconds while keeping reusable files cached.
- Check actual MR status at startup and when opening Review. Clean idle duplicates and caches for
  confirmed closed or merged MRs, preserving open files, local edits, untracked/ignored data, and
  caches whose status cannot be verified. An MR missing from a list is never enough to delete it.
- Limit background status requests to two at a time, sharing checks across cached revisions and
  throttling open MRs for five minutes. Hovering does not trigger remote cleanup checks.

Install `review-tools-for-gitlab-1.0.1.vsix`, then run **Developer: Reload Window**. The extension ID
remains `zubinzhang.review-tools-for-gitlab`; upgrading from the corrected 1.0.0 keeps your account.
Users of the older `zubinzhang.gitlab-review` build must uninstall it and authenticate again.

Validation: 301 Jest suites / 2717 tests, 30 real VS Code integration tests, and 7 packaging/license
tests passed. Integration coverage includes TypeScript and Go/gopls navigation, snapshot reuse,
duplicate cleanup, and preservation of open source files and the original dirty checkout.

See the [changelog](../CHANGELOG.md) and [release checks](release-1.0.1-checks.md) for details.
