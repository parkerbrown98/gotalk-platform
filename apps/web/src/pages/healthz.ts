import type { APIRoute } from 'astro';

// Rendered on demand so it reflects the running server, for load balancer and platform health checks.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response('ok\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
