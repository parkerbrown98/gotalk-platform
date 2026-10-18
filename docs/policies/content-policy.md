# Content policy (draft)

> **DRAFT. Not legally reviewed.** Items in `[brackets]` are decisions or legal input still needed.

This policy says what the public index will and won't show, and what we do about content that shouldn't be
there. It applies to our copy only. Each community also has its own rules and moderators.

## What the index accepts

Only forum boards and topics in places that are:

- public (never invite-only or private),
- opted in by the instance operator and the place owner,
- not marked NSFW,
- on a verified instance that passed our quality check,

and only posts that are visible to signed-out visitors, not deleted, not removed by moderators, and not from a
user who excluded their posts.

Chat, direct messages, drafts, attachments, edit history and member data are never indexed.

## What we remove

We remove pages and may suspend an instance when we find:

- **Illegal content**, including child sexual abuse material, which we report to the proper authorities,
  content that promotes terrorism, credible threats, and content we're legally required to remove.
- **Non-consensual intimate imagery, doxxing, and targeted harassment.**
- **Spam and manipulation**: pages made to rank in search, link farms, auto-generated or scraped content,
  and instances created mainly to host links.
- **Malware, phishing and scams.**
- **Content that breaks the law of `[jurisdiction]`** and can't be geoblocked.
- **Anything the author or the community asks us to take out** (see Takedowns).

`[LEGAL: refine categories and jurisdiction rules.]`

NSFW places and boards aren't indexed at all in this version, so adult content is handled by exclusion rather
than by review.

## Links in the index

Links posted by users are marked `rel="ugc nofollow noopener"`. We pass no search ranking to them. Images in
posts are shown as links and aren't loaded from the community's server.

## How we find problems

- Reports from the public (`[report form]`).
- Automated checks: the quality gate, blocklists of known bad origins and domains, and anomaly checks on size
  and growth.
- Reports from the community's operators.

We don't review all content before it appears. New instances are held in a `noindex` state until they pass the
quality gate: 14 days, 5 distinct authors, 50 public posts and no blocklist hits.

## What happens next

| Situation | Action |
|---|---|
| One page breaks the policy | Page removed, recorded so it isn't re-added |
| An author or operator asks for removal | Removed within an hour in normal operation, 24 hours at most |
| A place repeatedly breaks the policy | Place removed from the index |
| An instance is abusive, evasive or spam | Instance suspended or blocked, with its pages returning `410`. We contact the operator when we have a contact |
| Illegal content | Removed immediately. Reported where required |

## Takedowns and appeals

- **Request removal** of a page, or of your posts, at `[form]`. For your posts, the quickest way is the setting
  "Don't show my posts in public search results" on your server.
- **Appeal** a suspension or removal at `[contact]` with the origin or page address. We review appeals and reply
  within `[period]`.
- We record the identity of removed pages (origin, remote ID and a hash), not the content.

## Transparency

`[Decide: publish a periodic count of removals, suspensions and reports by category.]`
