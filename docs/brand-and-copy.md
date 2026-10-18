# Brand and copy

**Status: draft for review.** Brand assets, voice and the first-pass copy for the marketing site. Headline and
positioning decisions are settled in the [platform plan](platform-plan.md#phase-0--decisions-and-contracts-).
This page turns them into something Phase 1 can build from.

## On this page

- [Positioning](#positioning)
- [Voice](#voice)
- [Claims we can and cannot make yet](#claims-we-can-and-cannot-make-yet)
- [Brand assets](#brand-assets)
- [Visual system](#visual-system)
- [Page copy](#page-copy)
- [Page titles and descriptions](#page-titles-and-descriptions)
- [Compare page rules](#compare-page-rules)

## Positioning

**Headline (settled):** The forum-first community platform you can host yourself.

**One-sentence description:** Gotalk gives communities forums that people can search and find, with chat and
voice alongside them, on a server you run yourself and apps for every device.

**Elevator version:** Most community tools treat conversation as a stream that disappears. Gotalk starts from
forums, so what a community works out stays findable, and adds real-time chat, direct messages and voice. It is
open source and self-hostable. Any Gotalk app can connect to any Gotalk server.

**Three pillars** (used on the landing page and in features):

| Pillar | Message |
|---|---|
| Forums that last | Boards, topics, accepted answers, search. Public places can be found on the open web |
| Everything in one place | Chat, direct messages and voice channels next to the forums |
| Yours to host | One server binary, Docker Compose or Kubernetes. Open source. No vendor lock-in |

**Audiences**, in order of priority for the page:

1. People who want to join or start a community and need to know what Gotalk is and where to get the app.
2. Community owners and moderators comparing options, who care about control, moderation and searchability.
3. Self-hosters and developers, who care about the stack, the API, the licenses and the install story.
4. People looking for an answer, who arrive from a search engine on an index page.

## Voice

- **Plain and specific.** Say what a thing does. "Search across every board" beats "powerful discovery".
- **Calm and confident, not hype.** No superlatives and no "revolutionary". Let facts and screenshots carry it.
- **Respectful of the reader's time.** Short sentences. Lead with the point.
- **Honest about status.** If something is not available yet, say so. Never imply otherwise.
- **Technical when the reader is technical.** Self-host and API pages can use real commands and numbers.
- Use "community" for the group, "instance" or "server" for a deployment, "place" for a community within an
  instance, "board" and "topic" for forum structure. Do not use "guild" or "channel" for forums.
- Sentence case for headings. No exclamation marks outside a genuine celebration. No emoji in body copy.

## Claims we can and cannot make yet

Keep copy tied to what the repos document today. Re-check this list before launch.

| Claim | Status | Basis |
|---|---|---|
| Forum boards and topics with search | OK | Server Phase 2 |
| Real-time chat, DMs and presence | OK | Server Phase 3 |
| Voice and video channels (via a self-hosted LiveKit) | OK, with "optional, needs LiveKit" | Server Phase 4 |
| Bots, webhooks, a public OpenAPI API | OK | Server Phase 5 |
| Single Go binary, Docker, Helm and Kubernetes manifests | OK | Server Phase 7 |
| Server is AGPL-3.0, client is MIT | OK | READMEs |
| Any client connects to any instance | OK | Discovery via `/.well-known/gotalk-instance` |
| Desktop apps for macOS, Windows, Linux | OK, with notes | Windows installers unsigned today |
| Web app at `app.gotalk.sh` | OK | The same app exported as a SPA |
| iOS and Android apps | Wait | Built from the same codebase. Do not link or show store badges until published |
| Push notifications | Wait | Depends on the gateway and server integration, which are not finished |
| End-to-end encryption | Never claim | Not a goal in any plan |
| Federation between instances | Never claim | Explicitly a non-goal |
| Public forums findable in search engines | Wait | Only once the index launches. Describe as "coming" before then |

## Brand assets

Reuse the set in the client repo's `docs/brand`. The `build:brand` script copies and rasterizes the files into
`apps/web/public` (see [Development](development.md#brand-assets)) rather than referencing the other repo. Do not
edit the originals. If the brand changes, change it in the client repo first.

| File (client `docs/brand`) | Use here |
|---|---|
| `glyph.svg` | Header and footer logo mark, social image |
| `icon.svg`, `icon-square.svg` | Manifest icons (`icon-square.svg` for the Apple touch icon and the maskable icon) |
| `icon-macos.svg` | macOS download button and card (Phase 2) |
| `favicon.svg` | Favicon, plus the `.ico` fallback (16, 32 and 48 px) |
| `banner.svg` | Not used: it lists iOS and Android, which the site does not claim yet. The default social image is rendered from the headline instead |
| `android-*.svg` | Not used on the site |

Done in Phase 1: the header lockup (glyph plus "Gotalk" set in Inter as text) and the default 1200 by 630 social
image. Still needed: an open graph template for index pages, and platform icons for the download page (Apple,
Windows, Linux, Docker). Use a permissively licensed icon set for platform logos and follow each owner's brand
rules.

## Visual system

Follow the client's [DESIGN.md](https://github.com/parkerbrown98/gotalk-client/blob/main/DESIGN.md) through
`@gotalk/tokens` and its `--gt-*` CSS variables, so the site and the app stay visually continuous. Do not
copy values into this repo.

Summary of what the tokens give us, for reference when designing:

| Element | Value |
|---|---|
| Canvas | `#0e0f11`, with surfaces from `#151619` to `#2d2f34` |
| Text | `#f4f4f6` for headings, `#d4d4d6` for body, `#a8a9ab` for muted |
| Borders | 1px hairlines, `#2e3135` |
| Brand | Red gradient from `#ff5757` to `#a1131a`, with a soft red glow behind hero elements |
| Accents | Blue `#57c1ff`, green `#59d499`, yellow `#ffc533`, red `#ff6161` for status only |
| Type | Inter. Display sizes at weight 600 and tight line height |
| Style | Dark canvas, product screenshots as the hero, command-palette style cards |

Additional rules for the web:

- Dark theme at launch, matching the app. Honor `prefers-color-scheme` only if a light token set is added to
  `@gotalk/tokens`. Do not invent one here.
- Index pages are reading surfaces. Use a comfortable measure (about 70 characters), generous line height and
  strong contrast for body text. Code blocks and quotes follow the app's styles.
- Meet WCAG 2.2 AA contrast, visible focus states, and respect `prefers-reduced-motion`.
- Product visuals come from the client's `docs/mockups`. Export them as optimized images (AVIF and WebP with a
  PNG fallback) with explicit width and height to avoid layout shift. Do not embed the mockup HTML.

## Page copy

First-pass copy. Facts are from the repos' documentation. Product names for apps are not final.

### `/` landing page

**Hero**

> # The forum-first community platform you can host yourself.
> Gotalk brings forums, chat and voice together, so conversations stay findable and communities stay yours.
>
> [Download Gotalk] [Open the web app]
>
> Free and open source. Windows, macOS, Linux and the web today.

**Pillar section** (three cards)

> **Forums that last**
> Boards, topics and replies with accepted answers, tags and full-text search. What your community works out
> doesn't scroll away.
>
> **Chat and voice, next door**
> Real-time channels, direct messages and voice rooms sit beside the forums. Use whichever fits the moment.
>
> **Yours to host**
> Run Gotalk on a Raspberry Pi or a Kubernetes cluster. One server, your data, no lock-in.

**Any client, any server**

> ## Connect to any Gotalk server
> Type an address and go. Each server keeps its own accounts, and the app keeps a separate session for each.
> Not ready to host? Try Gotalk Official.

**Find the answer**

> ## Communities you can find
> Public places can opt in to appear in search results, so a good answer is still easy to find months later.
> [Explore public forums] *(shown only once the index has launched)*

**Open source**

> ## Open by design
> The server is AGPL-3.0 and the app is MIT. Read the code, run your own, build bots with the OpenAPI API.
> [View on GitHub]

**Closing call to action**

> ## Start in a few minutes
> [Download Gotalk] [Host your own server]

### `/features`

Sections: Forums, Chat and direct messages, Voice, Moderation and roles, Developer API, Privacy and ownership.
Each is a short paragraph, a screenshot and a "Learn more" link into the server docs. Only describe what exists
(see [claims](#claims-we-can-and-cannot-make-yet)).

### `/download`

> # Download Gotalk
> [Detected: Download for macOS (Apple silicon)] [Other downloads]
>
> **Desktop**: macOS (Apple silicon and Intel), Windows, Linux. Windows installers are not signed yet, so
> Windows may show a SmartScreen warning the first time you open them.
> **Web**: Open the web app at app.gotalk.sh.
> **Mobile**: iOS and Android apps are coming. *(Replace with store badges when published.)*
> **Run your own server**: See [Host your own server](#).
> Latest version: v{version}, released {date}. [Release notes] [All releases]

### `/self-host`

> # Host your own server
> One binary or one Compose file. You need PostgreSQL. Redis and LiveKit are optional.
>
> ```sh
> docker compose up -d
> docker compose logs gotalk     # copy the setup link it prints
> ```
> Open the link and the setup wizard checks your environment, names your instance, creates your administrator
> account and configures storage, email and voice.
> [Getting started] [Configuration] [Deploy on Kubernetes]

The snippet is pulled from the server repo at build time.

### `/open-source`

> # Built in the open
> Server: GNU AGPL-3.0. If you run a modified version as a network service, you offer its source to its users.
> Client: MIT.
> Repositories, how to contribute, and how releases are published.

### `/list-your-instance`

> # List your community in the public index
> Let search engines find your public forums. It's opt-in at three levels: you turn it on for the instance,
> place owners choose their places, and members can exclude their own posts.
>
> **What gets listed:** boards and topics in public places that owners opted in. Never private or invite-only
> places, chat, direct messages, email addresses or avatars.
> **How removal works:** turn it off, or delete or exclude content, and it leaves the index within an hour
> (24 hours at the latest).
> **How to list:** 1. Update your server. 2. Turn on Public directory in instance settings. 3. Register your
> address. 4. Place owners opt in places. 5. Pages go live after a short review period.
> [Read the protocol] [Crawler details] [Content policy]

### `/compare`

See [Compare page rules](#compare-page-rules).

### Index pages (`/explore/…`)

- **Header on each page:** the place or board name, the instance (linked), member count, and a clear "Public
  forum on {instance}" label so it is obvious the content comes from a community server.
- **Primary action:** "Open in Gotalk" (to the app) and "Join this community" where the place allows it.
- **Footer note:** "This is a public copy of a discussion hosted on {instance}. Content belongs to its
  authors. [Report] [How this index works] [Remove my posts]".
- **Empty and removed states:** a removed page returns `410` with a short explanation and a link to `/explore`.

### Error and empty states

- `404`: "We couldn't find that page. It may have been removed from the index." with links to `/explore` and `/`.
- `410`: "This page was removed. The community or the author took it out of the public index."
- `503`: "Back shortly. We're doing maintenance."

## Page titles and descriptions

Titles are 60 characters or fewer, descriptions 155 or fewer.

| Page | Title | Description |
|---|---|---|
| `/` | Gotalk: the forum-first community platform | Forums, chat and voice in one open-source community platform you can host yourself. Apps for desktop and web. |
| `/download` | Download Gotalk for macOS, Windows and Linux | Get the Gotalk desktop app or open it in your browser. Free and open source. |
| `/self-host` | Host your own Gotalk server | Run Gotalk with Docker Compose, a single binary or Kubernetes. Open source, PostgreSQL, optional Redis and LiveKit. |
| `/features` | Gotalk features: forums, chat, voice and moderation | Searchable forums, real-time chat, voice rooms, roles and moderation, and an OpenAPI API. |
| `/open-source` | Gotalk is open source | The server is AGPL-3.0 and the client is MIT. See the repositories and how to contribute. |
| `/explore` | Explore public Gotalk forums | Browse and search public forums and topics from Gotalk communities that opted in to the public index. |
| `/list-your-instance` | List your Gotalk community | Let search engines find your public forums. Opt in per instance, per place and per member. |
| `/compare` | Gotalk compared with other community platforms | A factual comparison of features, hosting and licensing. |
| Instance page | {Instance name} on Gotalk | Public forums hosted at {host}. Browse places, boards and topics. |
| Place page | {Place} forums at {host} | {Place description, truncated}. Public forum on {instance}. |
| Topic page | {Topic title} - {Place} | The first 150 characters of the opening post, plain text, with the place name when room allows. |

## Compare page rules

The page is allowed, but not in the hero or main copy.

- Factual and checkable. Each row states a verifiable capability or license, with the date it was checked and a
  link to the source. Review it every quarter, and when either project ships something relevant.
- Describe what Gotalk does and does not do. Include the places where another product is stronger.
- No opinions, no mocking, no unverifiable claims about market share or quality.
- Use the competitor's own terms for its features, and their names only as text, not logos.
- Rows: hosting model, license, forums, chat, voice and video, searchability on the open web, data export,
  bots and API, mobile apps, federation, pricing model.
- A short "Choose it if" section for each side, written fairly.
