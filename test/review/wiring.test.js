const assert = require('assert');
const vscode = require('vscode');

describe('Review Tools for GitLab extension wiring', () => {
  it('activates the independent review extension', () => {
    const extension = vscode.extensions.getExtension('zubinzhang.review-tools-for-gitlab');
    assert.ok(extension?.isActive);
    assert.equal(extension.packageJSON.displayName, 'Review Tools for GitLab');
    assert.equal(extension.packageJSON.icon, 'assets/review-tools.png');
    assert.equal(
      extension.packageJSON.contributes.viewsContainers.activitybar[0].icon,
      '$(review-tools)',
    );
  });

  it('registers every contributed review command', async () => {
    const extension = vscode.extensions.getExtension('zubinzhang.review-tools-for-gitlab');
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of extension.packageJSON.contributes.commands) {
      assert.ok(registered.has(command.command), command.command);
    }
    assert.ok(registered.has('gitlab-review.showRichContent'));
    assert.ok(registered.has('gitlab-review.prepareCodeNavigation'));
    assert.ok(
      ![...registered].some(command =>
        /^gitlab-review\..*(chat|duo|pipeline|security|snippet)/i.test(command),
      ),
    );
  });

  it('opens the merge request review view', async () => {
    await vscode.commands.executeCommand('gitlabReview.mergeRequests.focus');
  });
});
