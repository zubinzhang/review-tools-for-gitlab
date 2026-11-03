import * as packageJson from '../../desktop.package.json';
import { USER_COMMANDS } from './command_names';

describe('user commands', () => {
  it('should match upstream template actions after applying the review namespace', () => {
    const actionName = (command: string) => command.replace(/^(?:gl|gitlab-review)\./, '');
    const packageJsonCommands = packageJson.contributes.commands.map(c => actionName(c.command));
    const constantCommands = Object.values(USER_COMMANDS).map(actionName);
    expect(packageJsonCommands.sort()).toEqual(constantCommands.sort());
  });
});
