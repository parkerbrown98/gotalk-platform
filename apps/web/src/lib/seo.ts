import { repos, site } from './site';

/** Whether this build should be kept out of search engines (staging and previews). */
export const noindexBuild = import.meta.env.PUBLIC_NOINDEX === 'true';

/** The public path of a page. Builds use `build.format: 'file'`, so Astro reports `/features.html`. */
export function publicPath(pathname: string): string {
  return pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
}

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.url}/#organization`,
    name: site.name,
    url: site.url,
    logo: `${site.url}/icon-512.png`,
    sameAs: [repos.server, repos.client, repos.gateway],
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${site.url}/#website`,
    name: site.name,
    url: site.url,
    description: site.description,
    inLanguage: 'en',
    publisher: { '@id': `${site.url}/#organization` },
  };
}
