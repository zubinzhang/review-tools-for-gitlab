import { getAuthenticationConfiguration } from './extension_configuration';

export const getOAuthClientId = (instanceUrl: string): string | undefined =>
  getAuthenticationConfiguration().oauthClientIds[instanceUrl] || undefined;
