import type { APIRoute } from 'astro';

import { robotsTxt } from '../lib/crawlers';
import { noindexBuild } from '../lib/seo';
import { site } from '../lib/site';

export const GET: APIRoute = ({ site: configured }) =>
  new Response(robotsTxt((configured ?? new URL(site.url)).href, { noindex: noindexBuild }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
