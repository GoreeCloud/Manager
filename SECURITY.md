# Security policy

**Status:** Development alpha; no production deployment or security audit is claimed.

- **Private runtime:** Cloudflare Access must be enforced over the whole Manager hostname.
- **Fail closed:** Root Pages Functions middleware verifies Access-signed JWTs on static site requests and API requests. Missing Access configuration rejects both. Cloudflare Access policies must separately protect custom, production pages.dev, and preview origins.
- **Credential handling:** Provider API tokens stay in encrypted server-side configuration, never source or frontend storage.
- **Read-only:** Manager uses only GET operations and provides no mutation endpoints.
- **Minimization:** Only a small set of normalized metadata is sent to the browser. Provider errors are sanitized.
- **Dependencies:** No runtime package dependencies. Maintain Node.js and Cloudflare runtime security updates.
- **Review:** Verify access boundaries, token permissions, origin controls, rate limiting, accessibility, and real deployment behavior before release.

Report vulnerabilities privately to the repository owner. Do not include access tokens or personal data in public issues.
