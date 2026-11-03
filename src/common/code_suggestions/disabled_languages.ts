export const normalizeLanguageId = (languageId: string) => languageId.trim().toLowerCase();

export const isLanguageDisabled = (languageId: string, disabledLanguages: string[]) =>
  disabledLanguages.some(
    language => normalizeLanguageId(language) === normalizeLanguageId(languageId),
  );
