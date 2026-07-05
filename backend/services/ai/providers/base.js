// Shared error type for the AI provider adapter. A provider that isn't configured
// (no API key) throws this so the model router can skip it (and, if it were the
// only provider, fall through to reporting AI unavailable).

export class ProviderUnavailable extends Error {
  constructor(provider, message) {
    super(message || `${provider} provider is not configured`);
    this.name = 'ProviderUnavailable';
    this.provider = provider;
    this.code = 'provider_unavailable';
  }
}
