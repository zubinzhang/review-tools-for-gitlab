# Review Tools for GitLab 1.0.3

You can now browse commits while reviewing an MR in VS Code.

- Expand **MR → Commits** for commit titles, short SHAs, authors, and timestamps. Hover to read
  the full SHA and commit message.
- Expand a commit, then click a file for a native side-by-side comparison with its first parent.
- Added, removed, renamed, and initial-commit files use the exact selected revisions.
- **More commits…** and **More files…** load further pages on demand. **Open commit in GitLab**
  opens the commit's web page.

Single-commit diffs are read-only browsing views. Use the overall MR diff for inline comments,
viewed-file state, and worktree-backed definition navigation or hover documentation. This avoids
mixing historical commit positions with the current MR diff. GitLab diff limits still apply.

Install `review-tools-for-gitlab-1.0.3.vsix` and run **Developer: Reload Window**. The extension ID
remains `zubinzhang.review-tools-for-gitlab`; existing accounts and settings are retained.

Validation: 2749 unit tests, 32 real VS Code integration tests, and 7 packaging/license tests.
See the [changelog](../CHANGELOG.md) and [release checks](release-1.0.3-checks.md) for scope and limits.
