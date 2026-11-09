# Review Tools for GitLab™

![Review Tools icon](https://raw.githubusercontent.com/zubinzhang/review-tools-for-gitlab/main/src/assets/review-tools.png)

A review-only fork of GitLab for VS Code, targeting GitLab **15.11 and later**.
The extension ID is `zubinzhang.review-tools-for-gitlab`; commands use the `gitlab-review.*` namespace.
This extension is not affiliated, endorsed, sponsored, or approved with or by GitLab Inc.
GITLAB is a trademark of GitLab Inc. in the United States and other countries and regions.

Source and issue tracker: [review-tools-for-gitlab](https://github.com/zubinzhang/review-tools-for-gitlab).
Download the VSIX from [GitHub Releases](https://github.com/zubinzhang/review-tools-for-gitlab/releases).
See the [changelog](CHANGELOG.md) for release history and upgrade notes.

## Review Features

- Browse merge requests assigned to you, awaiting your review, created by you, or open in a project.
- Search merge requests and open their descriptions and discussions inside VS Code.
- Review side-by-side diffs, browse files in a directory tree by default, and mark files as viewed.
- Create and reply to inline discussions; edit, delete, resolve, and reopen comments.
- Retry failed comments, check out merge request branches, and open files in your local repository.
- Navigate to definitions from the new (right) side of diffs, including added files and symbols.
- Browse MR commits and compare individual commits with their first parent inside VS Code.

AI, Duo, language-server features, pipelines, issues, snippets, and security scanning are not activated
or contributed. The package includes only the review extension bundle and merge-request webview.

## Setup

1. Open a local Git repository with a remote pointing to your GitLab project.
2. Run **Review Tools for GitLab: Authenticate** from the command palette.
3. Enter the instance URL, including `http://` or `https://`.
4. Choose **Enter an existing token**, then enter a personal access token with the `api` scope.
5. Open **Review Tools for GitLab** in the activity bar and expand **Merge Requests**.

Credentials are stored using VS Code SecretStorage. HTTP is accepted for internal installations,
but it transmits credentials without transport encryption; prefer HTTPS where available.
Git remotes using SSH are supported; the API URL comes from the authenticated account.

## Commit History

Expand an MR, then **Commits**, to see its current commits with title, short SHA, author, and
timestamp. Hover over a commit for the full SHA and message. Expand a commit and select a changed
file to open its diff in VS Code. The left side is the first parent, and the right side is the
selected commit; an initial commit has an empty left side. Added, deleted, and renamed paths are
handled at those exact revisions. **Open commit in GitLab** opens the commit's web page.

Commit lists and changed files load only when expanded, in pages of 100. Expand **More commits…**
or **More files…** to continue. Collapse and expand to reload or retry. GitLab may limit large diffs;
binary files or omitted diff details are indicated, and the GitLab link remains available.
The commit list reflects current server membership, so refresh it after a rebase or force push.

Individual commit comparisons are read-only browsing views. MR comments, viewed-file checkboxes,
and worktree-backed semantic navigation/hover remain available in the overall MR diff. They are
not applied to individual commit comparisons, even when the selected commit is the latest MR head.

## Code Navigation

In a trusted workspace, clicking or expanding an MR automatically prepares a detached worktree
at that MR's reviewed commit and adds it as a workspace folder for language analysis. Loading the
MR list alone creates no worktrees. Your current branch, working files, and uncommitted changes
stay untouched. Prepared snapshots are reused, without a preparation dialog on MR selection.

Use **Go to Definition** (F12 / Command-click) on the right side of an MR diff once the language
extension finishes indexing. **Review Tools for GitLab: Prepare MR Code Navigation** remains
available for manually opened review documents.

Worktree-only Git/project updates no longer rebuild the visible MR tree. Stable node identities
preserve selection and expansion. VS Code may still reload extensions when converting a
single-folder window to a multi-root workspace; the extension saves the selected MR beforehand
and restores it if it remains available in the same project/query. This does not prevent VS Code's
first workspace-conversion reload or replace language-service indexing.
Install and configure the relevant language extension (for example, Go with gopls); project dependencies
and build settings must be available in the review worktree. This fork does not install dependencies
or execute project setup scripts automatically. Git fetches use your existing Git credentials,
not the API token, and fetch the target project's MR ref without checking out a local branch.

Targets in changed files automatically open the same MR's side-by-side diff at the definition line,
retaining its exact base/head commits and inline discussions. Added lines remain commentable.
For interface calls (such as Go interface methods), F12 goes to the interface declaration; use
**Go to Implementation** from the editor context menu to open the concrete implementation in its MR diff.
Unchanged repository files open as read-only documents at the MR commit but do not offer new inline
comments; external dependencies keep their original locations. Outdated review documents must be
refreshed before commenting.
The sidebar starts in tree mode; **View as List** remains available when needed.

Snapshots are cached under the extension's global storage, keyed by repository, MR, and full commit.
The same revision is reused; new revisions get separate worktrees. Treat these as review snapshots:
modified worktrees or mismatched file contents are rejected rather than used for incorrect jumps.
Review snapshots, including caches from the earlier extension ID, are hidden from the MR project
list. Duplicate workspace entries for the same repository, MR, and commit are consolidated.

While an MR is selected in the visible review sidebar, its worktree remains attached even before
a diff tab opens. When the MR is no longer selected and all review/source tabs are closed, the
worktree detaches after a 30-second quiet period. Its files remain cached; selecting the MR again
or requesting navigation reuses and reattaches it without another preparation prompt. Hover alone does not
reattach it. VS Code's Explorer still displays worktrees while language analysis needs them as
workspace folders; you can also right-click one and choose **Remove Folder from Workspace**.

On startup and when opening the review sidebar, background maintenance checks cached MRs directly.
An MR missing from a filtered or paginated list is not considered closed. Only a confirmed closed
or merged MR is eligible for cache deletion; open MRs retain one cache per revision, and clean idle
duplicates may be removed. Open review/source tabs, unsaved documents, local changes, untracked or
ignored files protect the corresponding worktree. Network failures preserve caches. Cleanup uses
Git's normal worktree removal without forcing deletion. Status requests are limited to two at a
time, and an open MR is not queried again for five minutes in the same session.
Old-side definition navigation is not supported yet. **Open MR File in Review Worktree** preserves
the active diff cursor position and also works for files absent from your current branch.

After the MR's workspace is prepared, hover over a function on the right side of the MR diff to
preview its signature and documentation comments without leaving the diff. Results come from the
language extension against that exact MR commit, including newly added functions. Hovering alone
never creates worktrees or asks for preparation; select the MR or run **Prepare MR Code Navigation** if needed.
Old-side hover is not supported. Language indexing, dependencies, and build settings affect which
documentation is available. Hover documentation cannot execute trusted Markdown command links.

The native VS Code diff supports collapsing unchanged regions with
`diffEditor.hideUnchangedRegions.enabled`. Folding arbitrary functions, including changed lines,
is not supported in this review view; enabling `editor.folding` does not change that limitation.

Review configuration retains the upstream `gitlab.*` setting names. The default custom queries
contain only merge requests. If existing settings include issue or pipeline queries, remove those
entries from `gitlab.customQueries`.

### Browse a Repository Without Cloning

Remote repository browsing is not included in this fork. Clone the repository locally and open it
in VS Code before reviewing merge requests.

## Build and Install

The current dependency lock includes build tools requiring Node.js 24.14 or later. With that runtime:

```sh
npm ci
npm run test:unit -- --runInBand src/desktop/review src/common/gitlab/check_version.test.ts
node --test scripts/utils/packages.test.mjs scripts/utils/third_party_notices.test.mjs
npm run test:review
npm run package
code --install-extension dist-desktop/review-tools-for-gitlab-1.0.3.vsix --force
```

Reload the VS Code window after installation. `npm run build:desktop` produces the unpacked extension
in `dist-desktop/`; `npm run package` also creates the VSIX. No marketplace publication is performed.

`npm test` runs unit, packaging, license-notice, and Review integration tests. Integration tests use an isolated
VS Code profile and exercise real TypeScript navigation and hover documentation. To also test Go, set
`REVIEW_TEST_EXTENSIONS_DIR` to an isolated extension directory containing `golang.go`,
`REVIEW_TEST_GOPLS_PATH` to the gopls executable, and optionally `REVIEW_TEST_GO_PATH` to Go.
Set `VSCODE_EXECUTABLE_PATH` to use an installed VS Code rather than downloading the test version.

## Minimum Supported Version

The compatibility baseline is GitLab 15.11. API reads were verified against GitLab 15.11.13-ee;
write-operation availability was inspected without modifying real merge requests. Review regressions
should also be exercised with the repository's mocked tests before deploying changes.

## Provenance

This fork reuses the upstream review implementation and preserves its MIT license. Original project:
[GitLab for VS Code](https://gitlab.com/gitlab-org/gitlab-vscode-extension).
The source baseline is upstream commit `43dcf78d09b3dc88b33a75ca67b72030c6e44910`.

The original review-tools icons in `src/assets/review-tools.*` and
`src/assets/icons/review-tools.svg` are available under the same MIT license. GitLab logos are
excluded from the extension package. The extension ID and GitHub repository name use
`review-tools-for-gitlab`.

### Upgrading From the Initial Local Build

Version 1.0.0 was reissued with extension ID `zubinzhang.review-tools-for-gitlab`. If you installed
the earlier `zubinzhang.gitlab-review` build, uninstall that extension before enabling this one,
install `review-tools-for-gitlab-1.0.3.vsix`, reload VS Code, and authenticate again. VS Code treats
the new ID as a separate extension; account secrets and viewed-file state are not migrated.
Prepared review worktrees under the earlier ID are recognized and reused, with duplicate and
completed-review caches subject to the cleanup rules above.

Builds generate `THIRD_PARTY_NOTICES.txt` from the actual extension and webview bundle inputs.
License texts missing from npm archives are retained under `third_party/licenses/` with source URLs.
Release source snapshots preserve upstream attribution without importing historical credentials.
