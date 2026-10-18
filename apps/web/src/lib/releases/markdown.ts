import MarkdownIt from 'markdown-it';

// Release notes can quote contributors (GitHub's generated notes list pull request titles), so they are
// treated as user content: raw HTML is escaped, links carry rel="ugc nofollow noopener", and markdown-it's
// link validation drops javascript:, vbscript:, file: and data: URLs. Images become links, because the
// site's Content Security Policy only allows same-origin images.
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('rel', 'ugc nofollow noopener');
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = String(token.attrGet('src') ?? '');
  const alt = md.utils.escapeHtml(token.content || 'image');
  if (!md.validateLink(src)) return alt;
  return `<a href="${md.utils.escapeHtml(src)}" rel="ugc nofollow noopener">${alt}</a>`;
};

/** Renders release notes. The shallowest heading becomes `minLevel`, so notes sit under the page's own. */
export function renderNotes(markdown: string, minLevel = 3): string {
  const tokens = md.parse(markdown, {});
  const headings = tokens.filter((t) => t.type === 'heading_open' || t.type === 'heading_close');
  const shallowest = Math.min(...headings.map((t) => Number(t.tag.slice(1))));
  for (const t of headings) {
    t.tag = `h${Math.min(Number(t.tag.slice(1)) - shallowest + minLevel, 6)}`;
  }
  return md.renderer.render(tokens, md.options, {});
}
