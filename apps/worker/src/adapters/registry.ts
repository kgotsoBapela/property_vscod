import { createFixtureAdapter, type SourceAdapter } from "@propintel/shared";

/**
 * Maps integrations.provider_key → adapter. Only the synthetic fixture exists today.
 * Add a real adapter here ONLY after its documentation, credentials, pricing and licensing are verified
 * (docs/provider-matrix.md). Provider secrets come from the worker environment / secrets manager,
 * never from database columns or the browser.
 */
const factories: Record<string, () => SourceAdapter> = {
  fixture_demo: () => createFixtureAdapter({ latencyMs: Number(process.env.FIXTURE_LATENCY_MS ?? 300) }),
};

export class AdapterNotConfiguredError extends Error {}

export function getAdapter(providerKey: string): SourceAdapter {
  const factory = factories[providerKey];
  if (!factory) {
    throw new AdapterNotConfiguredError(
      `No adapter for "${providerKey}". Provider access is unverified; implement an adapter after an agreement is in place.`,
    );
  }
  return factory();
}
