// @ts-check
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

import gotalkReleases from './integrations/releases.mjs';
import gotalkTokens from './integrations/tokens.mjs';

const site = process.env.SITE_URL ?? 'https://gotalk.sh';

// https://astro.build/config
export default defineConfig({
  site,
  trailingSlash: 'never',
  build: { format: 'file' },
  // Marketing pages are prerendered. Routes that opt out with `export const prerender = false`
  // (the public index, later phases) render on demand through the Node adapter.
  adapter: node({ mode: 'standalone' }),
  integrations: [
    gotalkTokens(),
    gotalkReleases(),
    sitemap({
      filter: (page) => !/\/404\/?$/.test(page),
    }),
  ],
  fonts: [
    {
      name: 'Inter',
      cssVariable: '--font-inter',
      provider: fontProviders.fontsource(),
      weights: ['100 900'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
  vite: {
    ssr: { noExternal: ['@gotalk/tokens'] },
  },
});
