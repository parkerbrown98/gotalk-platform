# gotalk-platform

The website at [gotalk.sh](https://gotalk.sh): what Gotalk is, where to get it, and (in later phases) a
search-engine index of public forums from Gotalk communities that opt in.

Gotalk is a forum-first, self-hostable community platform. The other projects are
[gotalk-server](https://github.com/parkerbrown98/gotalk-server),
[gotalk-client](https://github.com/parkerbrown98/gotalk-client) and
[gotalk-gateway](https://github.com/parkerbrown98/gotalk-gateway).

## Quick start

Requirements: Node 22.22+ (24 recommended, see [.nvmrc](.nvmrc)) and pnpm 11.

```sh
pnpm install
pnpm dev          # http://localhost:4321
```

## Commands

| Command            | Does                                                                    |
| ------------------ | ----------------------------------------------------------------------- |
| `pnpm dev`         | Dev server with hot reload                                              |
| `pnpm build`       | Production build to `apps/web/dist` (static pages plus the Node server) |
| `pnpm preview`     | Serve the production build locally                                      |
| `pnpm check`       | Type-check Astro and TypeScript files                                   |
| `pnpm test`        | Unit tests (Vitest)                                                     |
| `pnpm test:site`   | Run the built server against a fake GitHub API (after `pnpm build`)     |
| `pnpm lint`        | ESLint, including accessibility rules for `.astro` files                |
| `pnpm format`      | Format with Prettier (`pnpm format:check` to verify)                    |
| `pnpm check:links` | Verify every internal link and asset in the build resolves              |
| `pnpm verify`      | Everything CI runs, in order                                            |

## Documentation

- [Development](docs/development.md): layout, design tokens, screenshots and brand assets, checks
- [Deployment](docs/deployment.md): container image, configuration, release data and webhook, Cloudflare, staging
- [Platform plan](docs/platform-plan.md) and the [rest of the docs](docs/README.md)

## License

Not decided yet; see [open questions](docs/platform-plan.md#open-questions).
