# Crawler and indexer policy (draft)

> **DRAFT. Not legally reviewed.** Published at `gotalk.sh/crawler` once final. Items in `[brackets]` are
> still to be decided.

This page covers two things: the bot that reads opted-in Gotalk servers, and the rules for bots that read
`gotalk.sh`.

## 1. Our crawler, "GotalkIndexer"

GotalkIndexer reads the public index endpoints of Gotalk servers whose operators turned on Public directory
listing. It never reads private content and doesn't sign in.

- **User agent:** `GotalkIndexer/1 (+https://gotalk.sh/crawler)`
- **What it reads:** `/.well-known/gotalk-instance` and the `/api/v1/index/*` endpoints that the server
  publishes for this purpose. See the [protocol](../index-protocol.md).
- **How it behaves:** HTTPS only. At most 2 concurrent requests per server. It honors `Retry-After` and `429`,
  backs off on errors, never follows redirects, and doesn't fetch addresses inside content. It sends
  conditional requests (`If-None-Match`).
- **How often:** the change feed every 5 minutes, or sooner if the server pings us. The well-known document
  every 15 minutes. A full check every 24 hours.
- **IP addresses:** `[published list or a reverse DNS pattern, once hosting is chosen]`

**Stopping it:** turn off Public directory in your instance settings. The next fetch of the well-known document
(within 15 minutes) removes the instance from the index. You can also email `[crawler contact]` or return `429`
or `403` to the crawler's user agent. If it causes problems, contact us.

## 2. Bots that read gotalk.sh

`gotalk.sh/robots.txt` is the source of truth. The intent:

| Kind of bot | Policy | Examples |
|---|---|---|
| Search engines | Allowed | Googlebot, Bingbot, DuckDuckBot, Applebot |
| AI search and answer crawlers that fetch pages to cite and link back | Allowed | `OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot` |
| AI training crawlers | Disallowed | `GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`, `Applebot-Extended`, `Bytespider` |
| Everything else | Allowed on marketing pages and the index, within the limits below | |

- Disallowed paths for all bots: `/explore/search`, `/api/` and any URL with a filter or sort parameter.
- Please crawl politely: identify yourself, don't exceed about 1 request per second to the index, honor
  `Retry-After` and `Crawl-delay` if set, and don't try to enumerate pages the sitemaps don't list.
- `robots.txt` is advisory, so we also enforce the training-crawler rule at the CDN. We may block bots that
  ignore it or that put load on the site.
- The list of bot names is kept in one configuration file and reviewed `[quarterly]`, because names change.
  If we missed one, tell us.
- `llms.txt` points AI answer systems at our marketing and download pages and repeats this policy. It is not a
  license grant.

The content in the index belongs to its authors. Seeing a page doesn't give you a license to reuse it.
`[LEGAL: align with the terms.]`

## 3. Reporting problems

Report abuse, a bot that is misbehaving or a page that shouldn't be indexed at `[contact]`.
