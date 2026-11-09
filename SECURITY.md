# Security policy

**Status:** Development alpha; no production deployment or security audit is claimed.

- **Private runtime:** Cloudflare Access must be enforced over the whole Manager hostname.
- **Fail closed:** Root Pages Functions middleware verifies Access-signed JWTs on static site requests and API requests. A second exact `MANAGER_ALLOWED_EMAILS` check rejects valid Access users who are not explicitly allowlisted. Missing or malformed configuration rejects requests. Cloudflare Access policies must separately protect custom, production pages.dev, and preview origins.
- **Credential handling:** Provider API tokens stay in encrypted server-side configuration, never source or frontend storage.
- **Read-only:** Manager uses only GET operations and provides no mutation endpoints.
- **Minimization:** Only a small set of normalized metadata is sent to the browser. Provider errors are sanitized.
- **Dependencies:** No runtime package dependencies. Maintain Node.js and Cloudflare runtime security updates.
- **Review:** Verify access boundaries, token permissions, origin controls, rate limiting, accessibility, and real deployment behavior before release.

Report vulnerabilities privately to the repository owner. Do not include access tokens or personal data in public issues.

- **OpenRouter:** Inference-capable standard keys should be capped; optional management keys have broader account privileges. Only fixed GET endpoints are called, and keys and identifying response fields are never returned to the browser.

- **Immutable upstream transport:** The shared provider JSON reader enforces HTTPS, GET-only requests, no redirects, omitted cookies, bounded JSON response sizes, and an internal abort signal even if future adapter options request unsafe overrides. Provider adapters still use fixed, trusted endpoints and scoped runtime secrets.
