# Privacy policy (draft)

> **DRAFT. Not legally reviewed.** This describes intended behavior so the product and the policy can be
> checked against each other. It is not the final text and must not be published until legal review is done.
> Items in `[brackets]` are placeholders for decisions or legal input.

Last updated: `[date]`. Applies to `gotalk.sh` ("the site"), operated by `[legal entity and address]`.

## Summary

- The marketing pages set no cookies and we use cookie-free, aggregate analytics.
- The public index shows content that communities chose to publish. We don't add anything to it that wasn't
  already public on the community's server.
- You can have your posts left out of the index, and removed content leaves the index quickly.
- We never sell data and we don't run ads.

## What we collect

### When you visit the site

- **Aggregate analytics** from `[Plausible, cloud or self-hosted]`: page, referrer, country, browser and
  device class, with no cookies and no persistent identifier. We do not build profiles of visitors.
- **Server logs** with IP address, time, URL and user agent, kept for `[retention]` to run and secure the
  site, then deleted or anonymized. They are not used for advertising.
- **Downloads** are served from GitHub. GitHub receives your request under its own policy.

### When you use the public index

The index is a derived copy of public forum content from communities that opted in. For each post it stores and
shows what a signed-out visitor could already read on that server:

- the post text and its time stamps,
- the author's **username and display name**,
- the topic, board and place names and descriptions.

It does **not** store or show email addresses, IP addresses, avatars, private places, invite-only places, chat,
direct messages, attachments or edit history. NSFW places and boards are excluded.

Index pages set no cookies and contain no third-party trackers or advertising.

### When you contact us or submit a form

If you register an instance, report a page or request removal, we keep the information you send (such as an
origin, a page address, your message and the contact address you give) for as long as needed to handle it and
for `[retention]` afterwards.

## Who controls the content

The community server that hosts a discussion is its primary home and is run by someone else. We hold a copy.
Content belongs to its authors. Requests about content on the server (editing, deletion, account removal) go to
that server's operator. Requests about our copy go to us (see below). Deleting or excluding something on the
server removes it from our copy.

## Your choices

- **Leave your posts out of the index.** In your account settings on a Gotalk server, turn on "Don't show my
  posts in public search results". Your posts leave the index within an hour (24 hours at the latest).
- **Delete a post or your account** on the server. It leaves the index the same way.
- **Ask us to remove a page.** Use `[removal request form]`. We record the page's identity (origin, remote ID
  and a hash, not the content) so it isn't re-added.
- **Search engines.** Pages that left our index can stay in a search engine's cache for a while. We ask search
  engines to drop removed pages quickly, but we cannot control them.

`[LEGAL: lawful basis and notice for indexing public posts by default, rights of access, erasure and objection
by region, and whether any region requires opt-in. Pending.]`

## Sharing

We use hosting, CDN and analytics providers to run the site: `[Cloudflare, hosting provider, Plausible]`. They
process data on our behalf under agreements that limit their use. We disclose information when the law
requires it. We do not sell or rent personal data.

## Retention

| Data | Kept |
|---|---|
| Indexed content | While it is public on its server and the community stays listed. Removed within 1 hour in normal operation and 24 hours at most |
| Removal records | Origin, remote ID and a hash, `[retention]` |
| Server logs | `[retention]` |
| Analytics | Aggregate only, `[retention]` |
| Support and report messages | `[retention]` |

## Security

Index pages are served over HTTPS with a strict Content Security Policy and sanitized content. We limit access
to production systems and keep the index separate from anything that holds credentials. Gotalk's index never
holds passwords, session tokens or private content. `[LEGAL/SECURITY: breach notification process.]`

## Children

The site is not directed to children under `[age]`. `[LEGAL: age rules by region.]`

## Changes and contact

We'll post changes here and update the date, and give notice of material changes. Contact: `[privacy contact
address]`.
