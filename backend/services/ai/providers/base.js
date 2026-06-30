// Shared error types for AI provider adapters. A provider that isn't configured
// (no API key) or refuses a request throws one of these so the model router can
// skip it and fall through to the next candidate provider.

export class ProviderUnavailable extends Error {
  constructor(provider, message) {
    super(message || `${provider} provider is not configured`);
    this.name = 'ProviderUnavailable';
    this.provider = provider;
    this.code = 'provider_unavailable';
  }
}

export class ProviderRefusal extends Error {
  constructor(provider, message) {
    super(message || `${provider} provider refused the request`);
    this.name = 'ProviderRefusal';
    this.provider = provider;
    this.code = 'provider_refusal';
  }
}
