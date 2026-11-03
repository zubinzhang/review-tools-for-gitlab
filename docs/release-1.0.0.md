# Review Tools for GitLab 1.0.0

An independent VS Code extension for merge request review on GitLab 15.11 and later.

- Browse merge requests in a file tree, open side-by-side diffs, and manage inline discussions.
- Navigate definitions and implementations using isolated worktrees at the exact reviewed commit,
  including newly added code. Changed targets reopen the same MR diff for commenting.
- Preview function signatures and documentation on hover without leaving the review window.
- Use original split-code and comment icons, independent branding, and explicit upstream attribution.
- Include third-party license notices in the VSIX and updated Vue compatibility dependencies.

Install the attached `gitlab-review-1.0.0.vsix` using **Extensions: Install from VSIX**, then run
**Developer: Reload Window**. Existing local users keep the `zubinzhang.gitlab-review` extension ID.

See [release checks](release-1.0.0-checks.md) for test coverage, dependency-audit qualifications,
source-history handling, and feature limitations. Arbitrary folding of changed functions is not
included. GitHub publication does not publish the extension to the VS Code Marketplace.

This extension is not affiliated, endorsed, sponsored, or approved with or by GitLab Inc.
