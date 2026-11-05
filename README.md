# GoreeCloud Manager

**GoreeCloud Manager** is a private, read-only, web-native command center for understanding GoreeCloud's GitHub repositories, Cloudflare Pages deployments, OpenAI usage, and OpenRouter reporting without switching between consoles.

- **Source repository:** [GoreeCloud/Manager](https://github.com/GoreeCloud/Manager) — intentionally public.
- **Intended private site:** `https://manager.goreecloud.com`.
- **Status:** Development. A repository commit is **not** proof of an approved or operational deployment.
- **Design authority:** [GoreeCloud UI](https://github.com/GoreeCloud/gc-ui), following its semantic tokens, responsive navigation, Canvas/Surface/Lens hierarchy, and accessibility guidance.

Manager aggregates provider read results. The existing [GoreeCloud GitHub Dashboard](https://github.com/GoreeCloud/github-dashboard) remains a separately scoped GitHub-focused project; Manager does not claim that its unmerged code is available here.

## What works in source

| Integration | Read-only information | Configuration |
| --- | --- | --- |
| GitHub | Public repositories, stars, open work-item count (issues and PRs), language, last push, repository links, and five recent public Actions workflow runs | Public without token; optional read-only token with Actions read access for higher API limits |
| Cloudflare Pages | Up to 500 projects across bounded paginated reads, last reported deployment state, branch and time; incomplete totals are flagged | Cloudflare account ID and **Pages:Read** API token |
| OpenAI | Seven UTC calendar-day cost totals, completion request counts, input/output tokens, daily cost chart | **Organization admin key** (current provider API constraint) |
| OpenRouter | Per-key spending and limits; optional account credits and 30 completed UTC days of model activity | Dedicated capped API key; optional, separately reviewed management key |
| Connected sources | Individual connected / error / not configured states | Derived from actual API responses |

Missing data is never replaced with fabricated numbers. HTTP 429 may indicate a rate limit, request quota, or spending restriction; Manager reports this as an uncertain provider request limit, never guesses the exact cause, and does not automatically retry. Successful partial OpenAI reports retain verified fields while unavailable usage or cost values remain `null`. These reporting endpoints do not establish that new paid API requests will be accepted. Source totals may be truncated or delayed as documented by their APIs. Cloudflare Pages pagination is bounded to five 100-project pages and deduplicates project IDs; when more projects exist, the partial count is labeled incomplete. Refresh requests run concurrently, but one failing provider does not erase the others. GitHub Actions workflow errors are isolated from successful GitHub repository summaries; workflow activity defaults to `GoreeCloud/Manager` and may target another **verified public, active** repository with `GITHUB_ACTIONS_REPO`. Manager never queries Actions for a repository excluded from its public repository inventory, even when the supplied token has private-repository access. No infrastructure controls, deployment actions, GitHub mutations, or OpenAI generation endpoints exist in this app.

## Architecture

```text
Browser (HTML/CSS/JS, GC UI semantic roles)
  └── GET /api/overview (same-origin, private JSON, no cache)
       ├── Cloudflare Access JWT validation (signature + claims, fail closed)
       └── parallel read-only adapters
            ├── GitHub REST GET /users/{owner}/repos
            ├── Cloudflare GET /accounts/{id}/pages/projects
            └── OpenAI GET /organization/costs and /organization/usage/completions
```

Cloudflare Pages serves `public/`; the root middleware covers static and Function routes, while Functions in `functions/api/` read **server-side** secrets from `context.env`. There is no external frontend runtime or JavaScript package requirement. Source is plain, inspectable ESM.

## Security model

1. **Cloudflare Access and an independent owner allowlist are mandatory.** The root `functions/_middleware.js` protects **every Pages request, including static HTML/CSS/JavaScript and all API routes**, independently validating the signed Cloudflare Access JWT (RS256 signature/key ID, issuer, audience, expiration, not-before and subject). After signature verification, `lib/authorization.js` also requires the exact signed identity email to appear in `MANAGER_ALLOWED_EMAILS` (comma-separated, explicitly configured). Missing or malformed Access setup denies access with HTTP 401; a signed token without an allowlisted identity is denied with HTTP 403. **No email allowlist is bundled in the public repository.**
2. **Protect every origin.** Add a Cloudflare Access application/policy for `manager.goreecloud.com`, the production `*.pages.dev` hostname, and enable the separate Pages preview-deployment Access policy. Cloudflare documents that preview protection alone does not cover production pages.dev or custom domains. The root middleware is defense in depth, not a replacement for an owner-only Access allow policy. Static shell assets contain no live account data.
3. **Never put secrets in Git or frontend files.** Put provider tokens and `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` into Cloudflare Pages runtime environment variables (encrypt sensitive values as Secrets). Never use `VITE_*`, public JSON configs, query parameters, or client-side localStorage for API keys.
4. **Token scope matters.** For Cloudflare use **Pages:Read**, not a global API key. GitHub's optional token should have read-only minimal metadata scope. **OpenAI currently requires an organization admin key** for costs and usage, with provider-level privileges broader than this application's GET-only use; only enable if this risk is acceptable and the key is closely safeguarded.
5. **No mutation features.** Adapters only issue GET requests to fixed provider hosts; clients cannot select arbitrary external URLs. Provider errors are sanitized, redirects refused, responses normalized, and JSON sent with `no-store`. No database or analytics tracker is included.
6. **Isolation.** Source availability and Access identity are authoritative in their own systems. Manager is a read-only snapshot, not a control plane, SLA monitor, security attestation, or billing system of record.

### Cloudflare Pages setup (not automatically performed)

1. In **Workers & Pages**, create a Pages project connected to `GoreeCloud/Manager` using **Git integration**. Use `main` as the production branch, build command **`exit 0`** (Cloudflare's documented static-HTML recommendation for Pages Functions), output directory **`public`**, and repository root **`/`** so Pages discovers top-level `functions/`. After the initial Git deployment, verify that the Functions were actually bundled and that both static assets and APIs deny anonymous requests; a publicly accessible static-only shell is a release blocker. **Do not create via Wrangler Direct Upload**; Cloudflare does not permit switching a Direct Upload project to Git integration later. See [deployment runbook](docs/DEPLOYMENT_RUNBOOK.md).
2. Configure the Cloudflare Access application and owner-only policy **before exposing provider data**. Record its application audience (AUD) and team domain. Bind both to the Pages project as `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`. Also configure `MANAGER_ALLOWED_EMAILS` as a strict comma-separated list of the intended owner email identity or identities; this second check is required in every deployment environment, not a substitute for the Access allow policy.
3. Add the optional encrypted provider secrets:
   - `CF_ACCOUNT_ID`: your Cloudflare account ID.
   - `CF_PAGES_READ_TOKEN`: a token with Pages:Read permission scoped to that account.
   - `GITHUB_READ_TOKEN`: optional read-only token; without it the GitHub connector reads publicly visible repos only.
   - `OPENAI_ADMIN_KEY`: optional org admin key for usage/cost reports; review its broader provider permissions before enabling.
   - `GITHUB_OWNER`: `GoreeCloud` (default).
4. Verify unauthenticated GET requests to `/`, `/index.html`, `/app.js`, `/styles.css`, `/api/overview`, and `/api/session` fail closed; verify an authenticated but **non-allowlisted** user receives 403, and only an allowlisted owner returns the shell and JSON. Check each custom, production pages.dev, and preview hostname for direct and alternate-origin bypass.
5. Attach the custom domain `manager.goreecloud.com` to the Pages project using Cloudflare's domain controls. Verify DNS, TLS, Access, browser behavior and mobile layout. **Do not expose an unauthenticated provider-data endpoint.**
6. Confirm a real deployment, published URL, production read-only permissions and visual quality in a browser before calling the service live.

**Important:** A Cloudflare Pages domain and custom DNS record are not created by committing code. Cloudflare account access, permissions, identity policy and deployment checks remain required.

## Local development

Requires Node.js 20+ for checks/tests; the application itself has no install-time dependencies.

```bash
npm run check
npm test
npm run verify:pages-project # read-only Wrangler project inventory; fails until verified Git-linked project exists
npm run verify:anonymous   # expected to fail until the protected live site exists
```

To run Pages Functions locally, install an audited, pinned Wrangler release in your development environment and use `wrangler pages dev public`. Without a valid signed Cloudflare Access token the entire application intentionally returns 401, including in local development. A valid token without a configured matching `MANAGER_ALLOWED_EMAILS` identity returns 403. Tests exercise the authorization boundary with generated test keys and fake provider responses; no production credentials are used. The static UI can be served independently, but it will correctly show an unavailable state without the secured API.

```text
public/                First-party responsive dashboard and restrictive browser headers
functions/_middleware.js Root site-wide Cloudflare Access JWT verification
functions/api/          Protected read-only HTTP route
lib/                    Auth, network, aggregation and provider read adapters
tests/                  Node built-in test runner with deterministic provider fixtures
.github/workflows/      Minimal GitHub Actions checks with read-only repository permissions
wrangler.toml           Cloudflare Pages configuration
```

## Release and verification checklist

- [x] Dependency-free frontend source and read-only provider endpoints implemented.
- [x] Deterministic automated tests for data normalization, JWT verification and fail-closed behavior on static and API routes. Local Cloudflare Pages runtime confirmed HTTP 401 for anonymous homepage, styles, scripts and API on November 4, 2026.
- [ ] Production Cloudflare Access owner-only policy + preview-domain protection verified.
- [ ] Read-scoped Cloudflare/GitHub integration secrets provisioned.
- [ ] OpenAI admin-key exposure risk accepted and monitored, or connector kept disabled.
- [ ] Cloudflare Pages project and `manager.goreecloud.com` domain configured.
- [ ] End-to-end real-provider and unauthenticated/authorized browser checks.
- [ ] GC UI screenshot review across desktop/mobile, dark/light and high-contrast conditions.
- [ ] Production deployment, recovery and rollback independently accepted.

The application may be extended with other read-only providers by adding a normalized adapter and explicit, least-privileged server-side configuration. Do not add generic arbitrary-URL fetch proxies or client-supplied credentials.

## OpenRouter API

Manager can read the authenticated OpenRouter API key's daily, weekly, monthly, and lifetime spend and its optional spending limit from `GET /api/v1/key`. Configure `OPENROUTER_API_KEY` as an encrypted Pages secret. It is generation-capable outside Manager: prefer a separately capped key. Key spend is **not** an account balance.

Optional, separately reviewed `OPENROUTER_MANAGEMENT_KEY` enables `GET /api/v1/credits` for account credits and `GET /api/v1/activity` for requests, tokens, spend and top five models in the last 30 **completed UTC days**. Management keys have broader permissions than Manager's GET-only use. They are not necessary for per-key reporting.

Never put provider keys in a public file, browser storage or logs. All OpenRouter requests are fixed, server-side GET calls. Provider errors, missing credentials, partial data and actual zero spend remain distinguishable. OpenAI organization spend and OpenRouter key/account spend are **not** added because their scopes and periods differ.

Official provider documentation: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key ; https://openrouter.ai/docs/api/api-reference/credits/get-credits ; https://openrouter.ai/docs/api/api-reference/analytics/get-user-activity .

**Display precision:** Small nonzero USD amounts retain up to six decimal places rather than displaying as `$0.00`. The actual zero `$0.00` is distinct from missing or invalid values (`—`). Provider API results remain authoritative; formatting does not increase measurement precision.

**Status:** Deterministic development tests only; no live credentialed OpenRouter connection or production release is claimed.

## Browser tab-return session revalidation

When a loaded Manager tab receives a focus, visible-state or restored-page event, it hides private dashboard rows immediately and performs `GET /api/session`. The endpoint returns only `{"authenticated":true}` for an authorized, allowlisted Cloudflare Access identity and relies on the root middleware for signed-token and owner-email checks. Invalid responses, non-JSON pages, network errors and expired sessions leave private data cleared until a new authorized refresh. Revision guards prevent old, in-flight overview responses from restoring cleared data.

This is defense-in-depth for an already loaded browser tab. It does **not** revoke active Cloudflare Access sessions or prove instant logout propagation. Real owner and non-owner Access behavior must be tested on every deployed origin. See [session revalidation acceptance](docs/SESSION_REVALIDATION.md).
