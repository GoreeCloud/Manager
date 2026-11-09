# GoreeCloud Manager — controlled deployment runbook

**Status:** Development implementation and local checks only. Production is not deployed or accepted.

## Critical architecture decision

I require Manager to use **Cloudflare Pages Git integration** with the public `GoreeCloud/Manager` repository. Cloudflare explicitly states that a project created with **Direct Upload cannot later be converted to Git integration**. Do not create `goreecloud-manager` using `wrangler pages project create`, `wrangler pages deploy`, or dashboard Direct Upload.

Official docs: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [static HTML Pages build command](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/), [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [preview access](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

## Verified preflight — November 4, 2026

- GitHub source and main-branch CI pass; the read-only backend and premium responsive UI are implemented.
- The authorized GoreeCloud Cloudflare CLI identity was verified, and a read-only Pages project list did **not** contain `goreecloud-manager`.
- The account listed two Pages projects; available metadata did not confirm an existing Git-integrated project.
- The GitHub App installation endpoint returned HTTP 403 for the current GitHub token, so the Cloudflare GitHub App installation state remains unverified.
- The local Cloudflare Pages runtime denied anonymous `/`, `/index.html`, `/app.js`, `/styles.css`, and `/api/overview` with HTTP 401.
- Initial DNS checks were inconsistent: the domain was previously unresolved from the development laptop, and later checks resolved it to a **non-global/overlay address**. A subsequent HTTPS probe failed TLS negotiation (HTTP 000, curl exit 35). This is **not** verified public DNS, healthy TLS, or functioning Manager hosting.
- No live Pages release, owner-only Cloudflare Access policy, provider secrets, or custom-domain routing has been verified.

## Deployment acceptance sequence

1. Confirm the authorized Cloudflare account and domain-zone ownership; inventory existing routing and protect rollback options.
2. Review Cloudflare Pages GitHub App permissions and connect `GoreeCloud/Manager` through the official **Git integration** flow. Use production branch `main`, **build command `exit 0`** (Cloudflare's documented recommendation for static HTML with Pages Functions), output directory `public`, and repository root `/` so the checked-in top-level `functions/` directory can be discovered. Verify the actual build includes Pages Functions and that static HTML/CSS/JavaScript and API routes all fail closed before proceeding. A successful static-only deployment is **not** an acceptable Manager release.
3. Require an owner-only Cloudflare Access self-hosted application for both production custom domain `manager.goreecloud.com` and the production `goreecloud-manager.pages.dev` origin. Enable the **separate preview-deployment Access policy**. Preview protection alone does not protect production Pages or custom domains.
4. Set `CF_ACCESS_AUD`, `CF_ACCESS_TEAM_DOMAIN` and the strict owner identity allowlist `MANAGER_ALLOWED_EMAILS` in Pages runtime configuration. Until all are correctly configured, the root `functions/_middleware.js` intentionally denies **all static and API requests**, including direct Pages URLs. A valid Access token from a non-allowlisted user returns HTTP 403 even if the upstream Access allow policy is broader than intended.
5. Verify anonymous, signed-but-not-allowlisted identity and allowlisted owner-identity behavior on each origin. Validate signed JWT claims, issuer, audience, identity email and expiry in live Functions. Only then enable read-only provider integrations.
6. Use a Pages:Read Cloudflare token, public GitHub metadata or limited GitHub read token. **OpenAI organization admin keys are more privileged than this application**; enable only after an explicit scope/risk review and encrypted-secret provisioning.
7. Bind the requested custom domain and validate DNS/TLS, accessibility, security headers, error handling and private data leakage checks, then document verified deployment and rollback.

## Read-only anonymous-access verification

```bash
npm run check
npm test
# Optional read-only authorized Cloudflare CLI inventory check:
npm run verify:pages-project
npm run verify:anonymous
MANAGER_BASE_URL=https://goreecloud-manager.pages.dev npm run verify:anonymous
```

The Pages project preflight first queries the authorized Wrangler CLI using its **read-only** project-list command. Wrangler's JSON inventory can omit the Git source configuration. If the Manager project exists but its source cannot be verified from that inventory, the script can perform a **fixed HTTPS GET** to the official Cloudflare Pages project endpoint when `CF_ACCOUNT_ID` and a scoped `CF_PAGES_READ_TOKEN` are already available in the local environment. It checks the exact `GoreeCloud/Manager` GitHub source and production branch `main`; it never sends a project-creation, deployment, or permission-changing request. Never save the read token to a repository or print it in logs. If the project is absent, credentials are unavailable, or source/branch verification fails, the preflight remains **not ready**. A passing preflight does **not** verify Cloudflare Access policies, the owner allowlist, DNS/TLS, a deployed site, or API credentials.

The anonymous probe performs six HTTPS GET requests (`/`, `/index.html`, `/app.js`, `/styles.css`, `/api/overview`, and `/api/session`) without session cookies or credentials. It accepts only `manager.goreecloud.com`, `goreecloud-manager.pages.dev`, and single-label preview origins belonging to that specific Pages project; it rejects unrelated `pages.dev` projects. It uses manual redirect handling, discards response bodies and **fails** on public HTTP 2xx, unknown redirects, or unreachable paths. Exit status 0 confirms only that the tested paths were denied anonymously; it is **not proof** of every route, authorized-user correctness or complete security.

## Release gate

- [ ] Git-linked Pages deployment configured in the intended account (`main`, build command `exit 0`, output `public`, repository root `/`)
- [ ] Pages Functions are actually bundled and active; protected static assets **and** `/api/overview` + `/api/session` deny anonymous traffic after initial deploy
- [ ] Access policies verified for production custom, production Pages, and preview origins
- [ ] Unauthorized and authorized browser sessions tested, including expired JWT
- [ ] API-only read token scopes and secret isolation verified
- [ ] Provider metrics verified against each authoritative provider
- [ ] Desktop/mobile, dark/light, keyboard/assistive technology, contrast and reduced-motion states checked
- [ ] Domain/DNS/TLS checks and recovery path verified
- [ ] Canonical GoreeCloud Drive inventory and project records synchronized **in place**

No deployment, Access policy change, DNS operation or secret provisioning is implied by this document.

## Optional OpenRouter readiness

After verified Access protections on every reachable hostname, configure a dedicated, capped OpenRouter standard key for per-key spending, if desired. Optional account credits and activity require independently reviewed management credentials. Keep either key as an encrypted Pages Secret. Validate both per-key and account-level metrics against OpenRouter and confirm that no credential or identifying key metadata is present in API responses or browser traces.
