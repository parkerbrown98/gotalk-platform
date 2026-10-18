// Crawler policy for gotalk.sh (platform plan, "AI crawler policy"; docs/policies/crawler.md).
// This is the one place the bot names live. Review it regularly: names change and new crawlers appear.

/** AI training crawlers. Disallowed everywhere. Cloudflare bot rules enforce this too. */
export const aiTrainingCrawlers = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'Meta-ExternalAgent',
  'cohere-training-data-crawler',
  'Diffbot',
] as const;

/** AI search and answer crawlers that fetch pages to cite and link back. Allowed like search engines. */
export const aiSearchCrawlers = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'PerplexityBot',
] as const;

/** Paths no crawler should fetch. They do not exist yet; they are reserved for the public index. */
export const disallowedPaths = ['/explore/search', '/api/'] as const;

export function robotsTxt(siteUrl: string, { noindex = false } = {}): string {
  if (noindex) {
    // Staging builds stay crawlable so crawlers can see each page's noindex instruction.
    return '# Staging build: every page is marked noindex.\n\nUser-agent: *\nAllow: /\n';
  }
  const lines: string[] = [
    '# gotalk.sh: search engines and AI search welcome; AI training crawlers are not.',
    '',
  ];
  for (const agent of aiTrainingCrawlers) lines.push(`User-agent: ${agent}`);
  lines.push('Disallow: /', '');
  for (const agent of aiSearchCrawlers) lines.push(`User-agent: ${agent}`);
  lines.push('User-agent: *');
  for (const path of disallowedPaths) lines.push(`Disallow: ${path}`);
  lines.push('', `Sitemap: ${new URL('/sitemap-index.xml', siteUrl).href}`, '');
  return lines.join('\n');
}
