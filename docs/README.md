# Gotalk platform documentation

Documentation for `gotalk-platform`, the marketing and public-index website served at
[gotalk.sh](https://gotalk.sh).

## On this page

- [Build and run](#build-and-run)
- [Project planning](#project-planning)
- [Specifications](#specifications)
- [Brand and copy](#brand-and-copy)
- [Policies (drafts)](#policies-drafts)
- [Related projects](#related-projects)

## Build and run

| Page | What's in it |
|---|---|
| [Development](development.md) | Layout, design tokens, screenshots and brand assets, release pages, SEO and crawlers, checks |
| [Deployment](deployment.md) | Container image, configuration, release data and the release webhook, Cloudflare settings, staging |

## Project planning

| Page | What's in it |
|---|---|
| [Platform plan](platform-plan.md) | Goals, framework decision, site map, the opt-in index design, settled decisions, cross-repo dependencies, phases and open questions |
| [Phase 3 work breakdown](phase-3-work-breakdown.md) | The server and client work the index depends on, with tasks and an acceptance checklist |

## Specifications

| Page | What's in it |
|---|---|
| [Public index protocol](index-protocol.md) | How an instance opts in, the dedicated read endpoints, the change feed, reconcile, ping, registration, status lifecycle and fetch rules |

## Brand and copy

| Page | What's in it |
|---|---|
| [Brand and copy](brand-and-copy.md) | Positioning, voice, claims guardrails, brand assets, visual system, page copy and meta titles |

## Policies (drafts)

Drafts of the intended behavior. **Not legally reviewed. Do not publish.**

| Page | What's in it |
|---|---|
| [Privacy policy](policies/privacy.md) | What the site and index collect and show, retention and user choices |
| [Terms of service](policies/terms.md) | Use of the site, listing obligations, index content (license clause pending legal input) |
| [Content policy](policies/content-policy.md) | What the index accepts and removes, takedowns and appeals |
| [Crawler policy](policies/crawler.md) | The `GotalkIndexer` bot and rules for bots reading `gotalk.sh` |

## Related projects

| Project | Role |
|---|---|
| [gotalk-server](https://github.com/parkerbrown98/gotalk-server) | The instance. Source of the public content the index mirrors |
| [gotalk-client](https://github.com/parkerbrown98/gotalk-client) | Web app at `app.gotalk.sh`, desktop and mobile apps |
| [gotalk-gateway](https://github.com/parkerbrown98/gotalk-gateway) | Push gateway. Its instance verification and signed-request design are reused here |
