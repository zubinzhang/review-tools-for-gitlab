import * as packageJson from '../../package.json';
import * as desktopPackageJson from '../../desktop.package.json';

type PropertyInfo = { name: string; order?: number; scope?: string };

const getConfigPropertiesForCategory = (categoryId: string): PropertyInfo[] => {
  const categoryConfig = {
    ...packageJson.contributes.configuration.find(c => c.id === categoryId)?.properties,
    ...desktopPackageJson.contributes.configuration.find(c => c.id === categoryId)?.properties,
  };

  return Object.entries(categoryConfig).map(([name, config]) => {
    const { order, scope } = config as { order?: number; scope?: string };

    return { name, order, scope };
  });
};

const sortProperties = (properties: PropertyInfo[]): string[] => {
  return [...properties]
    .sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
    .map(p => p.name);
};

describe('config properties', () => {
  it('match defined order in duo category', () => {
    const expectedFirstProperties = [
      'gitlab.duoCodeSuggestions.enabled',
      'gitlab.duoChat.enabled',
      'gitlab.duoAgentPlatform.enabled',
      'gitlab.duoCodeSuggestions.disabledLanguages',
      'gitlab.duo.enabledWithoutGitlabProject',
      'gitlab.keybindingHints.enabled',
      'gitlab.duoAgentPlatform.sandbox.enabled',
      'gitlab.duo.proxy.directConnection',
      'gitlab.duoCodeSuggestions.openTabsContext',
    ];

    const properties = getConfigPropertiesForCategory('duo');
    const sortedProperties = sortProperties(properties);
    const actualFirstProperties = sortedProperties.slice(0, expectedFirstProperties.length);

    expect(actualFirstProperties).toEqual(expectedFirstProperties);
  });

  it('scopes the direct proxy setting to the current machine', () => {
    const properties = getConfigPropertiesForCategory('duo');

    expect(properties).toContainEqual({
      name: 'gitlab.duo.proxy.directConnection',
      order: 9,
      scope: 'machine',
    });
  });

  it('scopes the sandbox setting to the application so workspaces cannot override it', () => {
    const properties = getConfigPropertiesForCategory('duo');

    expect(properties).toContainEqual({
      name: 'gitlab.duoAgentPlatform.sandbox.enabled',
      order: 8,
      scope: 'application',
    });
  });

  it('match defined order in custom-certificates category', () => {
    const expectedFirstProperties = ['gitlab.ca', 'gitlab.cert', 'gitlab.certKey'];

    const properties = getConfigPropertiesForCategory('custom-certificates');
    const sortedProperties = sortProperties(properties);
    const actualFirstProperties = sortedProperties.slice(0, expectedFirstProperties.length);

    expect(actualFirstProperties).toEqual(expectedFirstProperties);
  });

  it('match defined order in other category', () => {
    const expectedFirstProperties = ['gitlab.debug'];

    const properties = getConfigPropertiesForCategory('other');
    const sortedProperties = sortProperties(properties);
    const actualFirstProperties = sortedProperties.slice(0, expectedFirstProperties.length);

    expect(actualFirstProperties).toEqual(expectedFirstProperties);
  });
});
