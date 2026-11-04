# Review Tools for GitLab 1.0.2

Selecting or expanding an MR now prepares its exact-commit worktree automatically in a trusted
workspace. Existing snapshots are reused, and the visible sidebar keeps its selection and expansion
when Git discovers or removes review worktrees.

- Prepare code navigation before the first F12 request, without a preparation dialog on MR selection.
- Preserve project/query/MR node identities and ignore worktree-only project refreshes.
- Save the selected MR before workspace changes and restore it after an extension-host restart if
  the MR remains available in the same project/query. A slower previous MR request cannot replace
  a newer selection.
- Share concurrent diff-version requests between preparation and file loading.
- Keep the selected MR attached while its sidebar is visible, even before opening a diff.

VS Code may still reload the extension host on its first single-folder to multi-root conversion.
This release restores the chosen MR after that transition; it does not suppress VS Code's native
reload or language-service indexing.

Install `review-tools-for-gitlab-1.0.2.vsix` and run **Developer: Reload Window**. The extension ID
remains `zubinzhang.review-tools-for-gitlab`, so accounts from corrected 1.0.0 and 1.0.1 are retained.

See the [changelog](../CHANGELOG.md) and [release checks](release-1.0.2-checks.md).
