# GoreeCloud Manager — controlled deployment runbook

**Status:** Development implementation and local checks only. Production is not deployed or accepted.

## Critical architecture decision

I require Manager to use **Cloudflare Pages Git integration** with the public `GoreeCloud/Manager` repository. Cloudflare explicitly states that a project created with **Direct Upload cannot later be converted to Git integration**. Do not create `goreecloud-manager` using `wrangler pages project create`, `wrangler pages deploy`, or dashboard Direct Upload.

Official docs: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [preview access](https://developers.cloudflare.com/pages/configuration/preview-deployments/).

## Verified preflight — November 4, 2026

- GitHub source and main-branch CI pass; the read-only backend and premium responsive UI are implemented.
- The authorized GoreeCloud Cloudflare CLI identity was verified, and a read-only Pages project list did **not** contain `goreecloud-manager`.
- The account listed two Pages projects; available metadata did not confirm an existing Git-integrated project.
- The GitHub App installation endpoint returned HTTP 403 for the current GitHub token, so the Cloudflare GitHub App installation state remains unverified.
- The local Cloudflare Pages runtime denied anonymous `/`, `/index.html`, `/app.js`, `/styles.css`, and `/api/overview` with HTTP 401.
- `manager.goreecloud.com` did not resolve during the earlier read-only network check.
- No live Pages release, owner-only Cloudflare Access policy, provider secrets, or custom-domain routing has been verified.

## Deployment acceptance sequence

1. Confirm the authorized Cloudflare account and domain-zone ownership; inventory existing routing and protect rollback options.
2. Review Cloudflare Pages GitHub App permissions and connect `GoreeCloud/Manager` through the official **Git integration** flow. Use `main`, an empty build command, `public` output, and repository root `functions/`.
3. Require an owner-only Cloudflare Access self-hosted application for both production custom domain `manager.goreecloud.com` and the production `goreecloud-manager.pages.dev` origin. Enable the **separate preview-deployment Access policy**. Preview protection alone does not protect production Pages or custom domains.
4. Set `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` as Pages runtime configuration. Until configured, the root `functions/_middleware.js` intentionally denies **all static and API requests**, including direct Pages URLs.
5. Verify anonymous, disallowed-identity and owner-identity behavior on each origin. Validate signed JWT claims, issuer, audience and expiry in live Functions. Only then enable read-only provider integrations.
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

The Pages project preflight queries the authorized Wrangler CLI with a read-only project-list command and requires verified `GoreeCloud/Manager` Git integration. It prints no provider secrets or unrelated account metadata. An absent or unverified source is not ready; the script never creates a project. A passing result does not confirm the Access policy, DNS/TLS, or a deployed site.

The anonymous probe performs three HTTPS GET requests without session cookies or credentials. It uses manual redirect handling, discards response bodies and **fails** on public HTTP 2xx, unknown redirects, or unreachable paths. Exit status 0 confirms only that the tested paths were denied anonymously; it is **not proof** of every route, authorized-user correctness or complete security.

## Release gate

- [ ] Git-linked Pages deployment configured in the intended account
- [ ] Access policies verified for production custom, production Pages, and preview origins
- [ ] Unauthorized and authorized browser sessions tested, including expired JWT
- [ ] API-only read token scopes and secret isolation verified
- [ ] Provider metrics verified against each authoritative provider
- [ ] Desktop/mobile, dark/light, keyboard/assistive technology, contrast and reduced-motion states checked
- [ ] Domain/DNS/TLS checks and recovery path verified
- [ ] Canonical GoreeCloud Drive inventory and project records synchronized **in place**

No deployment, Access policy change, DNS operation or secret provisioning is implied by this document.
