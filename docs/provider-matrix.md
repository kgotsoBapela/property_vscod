# Provider matrix

Status as of 2026-09-29: **no commercial provider has been verified.** Every cell marked *Unknown* must be filled
from provider documentation, a signed agreement or written confirmation before an adapter is built. Do not
infer prices, fields or rights from marketing pages.

| Provider | Category | Endpoint / feed | Auth | Key fields | Historical coverage | Geographic coverage | Update frequency | Quota | Cost per call / month | Display / retention / export rights | Automated refresh permitted | Document provenance | Status | Contact owner |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Synthetic fixture (`fixture_demo`) | fixture | in-process | none | all normalized fields | synthetic 2004–2026 | 3 fictional suburbs | on demand | n/a | R0 | synthetic, unrestricted | yes | example.org placeholders | **active (demo only)** | engineering |
| Lightstone | property data | Unknown (portal.apis.lightstone.co.za) | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | candidate | Unassigned |
| Property24 Property Data | property data | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown (reuse **unconfirmed**) | Unknown | Unknown | candidate | Unassigned |
| Lexis WinDeed | deeds / valuations | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown (retention **unconfirmed**) | Unknown | Unknown | candidate | Unassigned |
| Deeds registry / resellers | deeds | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | candidate | Unassigned |
| Aucor Property | auctions | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | candidate | Unassigned |
| GemFinder | sheriff notices | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | candidate | Unassigned |
| RepoLens | sheriff / Gazette | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | candidate | Unassigned |
| Government Printing Works | Gazette | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | Unknown | candidate | Unassigned |

## Outreach checklist (per provider)

1. API or feed documentation, including endpoint list, auth method and sandbox access.
2. Sample payloads for: a freehold erf, a subdivided erf (portions), a sectional-title unit, a property with no transfers, a sale in execution.
3. Field definitions: sale vs registration date, transfer type / arm's-length flag, how the price is disclosed, AVM methodology and confidence.
4. Coverage: provinces, municipalities, years of history, update latency after Deeds Office registration.
5. Pricing: per-call, per-record and monthly minimums; what counts as a billable call; quota and rate limits.
6. Rights: may we display, store (and for how long), export to PDF/CSV, share within the team, and cache raw payloads?
7. Automated refresh: is scheduled daily sync allowed? More frequent auction re-checks?
8. Deletion semantics: how removed/corrected records are signalled (absence from a page is **not** deletion).
9. Personal information: which owner/debtor fields are returned, and can they be suppressed at source?
10. Named commercial and technical contacts, SLA, and change-notification process.

## Adding a real adapter

Implement `SourceAdapter` (`packages/shared/src/adapters/types.ts`) in `apps/worker/src/adapters/`, validate raw payloads with a
Zod schema written from the **documented** response, map to the normalized schema, register it in
`apps/worker/src/adapters/registry.ts`, and add contract tests with the provider's sample payloads. Set `licensing` from the
agreement. Credentials come from the worker's environment/secrets manager only.
