import { createFixtureAdapter, IMPLEMENTED_ADAPTERS, type SourceAdapter } from "@propintel/shared";

/** Decrypted credentials for one integration, loaded from Supabase Vault at job time ({ api_key: "…" }). */
export type IntegrationCredentials = Record<string, string>;

/**
 * Maps integrations.provider_key → adapter factory. Only the synthetic fixture exists today.
 * Add a real adapter here ONLY after its documentation, pricing and licensing are verified
 * (docs/provider-matrix.md), and add its key to IMPLEMENTED_ADAPTERS in packages/shared/src/integrations.ts.
 * Credentials are entered by a Super Admin on the Integrations page, stored in Vault, and passed in here;
 * never log them or put them in error messages.
 */
const factories: Record<string, (credentials: IntegrationCredentials) => SourceAdapter> = {
  fixture_demo: () => createFixtureAdapter({ latencyMs: Number(process.env.FIXTURE_LATENCY_MS ?? 300) }),
};

for (const key of Object.keys(factories)) {
  if (!IMPLEMENTED_ADAPTERS.includes(key)) throw new Error(`Adapter "${key}" is missing from IMPLEMENTED_ADAPTERS`);
}

export class AdapterNotConfiguredError extends Error {}

export function getAdapter(providerKey: string, credentials: IntegrationCredentials = {}): SourceAdapter {
  const factory = factories[providerKey];
  if (!factory) {
    throw new AdapterNotConfiguredError(
      `No connector has been built for "${providerKey}" yet. Credentials alone are not enough; a connector must be written from the provider's documentation.`,
    );
  }
  return factory(credentials);
}
