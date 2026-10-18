import type { APIRoute } from 'astro';

import { links, repos, site } from '../lib/site';

const body = `# ${site.name}

> ${site.headline} Gotalk is an open-source platform for forum-first communities, with real-time chat, direct messages and voice alongside the forums. Anyone can run a Gotalk server, and any Gotalk app can connect to any server.

Gotalk is in beta. The server and push gateway are licensed under the GNU AGPL-3.0, and the client under MIT.

## Pages

- [Home](${site.url}/): what Gotalk is
- [Features](${site.url}/features): forums, feeds and search, chat, voice, moderation, developer API, self-hosting
- [Open source](${site.url}/open-source): repositories, licenses, contributing
- [Changelog](${site.url}/changelog): release notes for the apps and server

## Get Gotalk

- [Download](${site.url}/download): desktop apps for Windows, macOS and Linux, with checksums
- [Web app](${site.appUrl})
- [Host your own server](${site.url}/self-host): Docker Compose, binaries, container image, Kubernetes
- [Server getting-started guide](${links.serverGettingStarted})

## Source and documentation

- [gotalk-server](${repos.server}) and its [documentation](${links.serverDocs})
- [gotalk-client](${repos.client})
- [gotalk-gateway](${repos.gateway})

## Use of this site

Search engines and AI search or answer tools that link back to their sources may read this site. AI training crawlers are not permitted; see /robots.txt. This file is not a license to reuse any content.
`;

export const GET: APIRoute = () =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
