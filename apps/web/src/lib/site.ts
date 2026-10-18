const github = 'https://github.com/parkerbrown98';

export const repos = {
  server: `${github}/gotalk-server`,
  client: `${github}/gotalk-client`,
  gateway: `${github}/gotalk-gateway`,
} as const;

const serverDocs = `${repos.server}/blob/main/docs`;

export const site = {
  name: 'Gotalk',
  url: 'https://gotalk.sh',
  headline: 'The forum-first community platform you can host yourself.',
  description:
    'Forums, chat and voice in one open-source community platform you can host yourself. Apps for desktop and web.',
  appUrl: 'https://app.gotalk.sh',
  officialInstance: 'api.gotalk.sh',
  github,
} as const;

// Destinations used across pages. The GitHub release pages are full lists, not /releases/latest, which
// skips pre-releases.
export const links = {
  downloads: '/download',
  selfHost: '/self-host',
  changelog: '/changelog',
  clientReleases: `${repos.client}/releases`,
  serverReleases: `${repos.server}/releases`,
  serverImage: 'ghcr.io/parkerbrown98/gotalk-server',
  helmChart: `${repos.server}/tree/main/deploy/helm/gotalk`,
  kustomize: `${repos.server}/tree/main/deploy/kubernetes`,
  cli: `${serverDocs}/cli.md`,
  serverGettingStarted: `${serverDocs}/getting-started.md`,
  serverDocs: `${serverDocs}/README.md`,
  deployment: `${serverDocs}/deployment.md`,
  configuration: `${serverDocs}/configuration.md`,
  storageAndEmail: `${serverDocs}/storage-and-email.md`,
  backup: `${serverDocs}/backup-and-restore.md`,
  apiOverview: `${serverDocs}/api-overview.md`,
  apiForum: `${serverDocs}/api-forum.md`,
  apiPlaces: `${serverDocs}/api-places.md`,
  apiChat: `${serverDocs}/api-chat.md`,
  apiVoice: `${serverDocs}/api-voice.md`,
  apiModeration: `${serverDocs}/api-moderation.md`,
  apiDevelopers: `${serverDocs}/api-developers.md`,
  serverDevelopment: `${serverDocs}/development.md`,
  clientDevelopment: `${repos.client}/blob/main/docs/development.md`,
  clientReleaseDocs: `${repos.client}/blob/main/docs/releases.md`,
  gatewayContributing: `${repos.gateway}/blob/main/CONTRIBUTING.md`,
} as const;

export const nav = [
  { href: '/features', label: 'Features' },
  { href: '/self-host', label: 'Self-host' },
  { href: '/open-source', label: 'Open source' },
  { href: links.serverDocs, label: 'Docs' },
] as const;
