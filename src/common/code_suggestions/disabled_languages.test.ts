import { isLanguageDisabled, normalizeLanguageId } from './disabled_languages';

describe('disabled languages', () => {
  it.each`
    languageId  | disabledLanguages | expected
    ${'python'} | ${['python']}     | ${true}
    ${'python'} | ${[' Python ']}   | ${true}
    ${'Python'} | ${['python']}     | ${true}
    ${'python'} | ${['javascript']} | ${false}
    ${'python'} | ${[]}             | ${false}
  `(
    'isLanguageDisabled($languageId, $disabledLanguages) is $expected',
    ({ languageId, disabledLanguages, expected }) => {
      expect(isLanguageDisabled(languageId, disabledLanguages)).toBe(expected);
    },
  );

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeLanguageId(' Python ')).toBe('python');
  });
});
