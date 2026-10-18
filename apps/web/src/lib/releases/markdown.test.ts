import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { renderNotes } from './markdown.ts';
import { verifySignature } from './webhook.ts';

describe('renderNotes', () => {
  it('renders GitHub release notes with linkified URLs and ugc links', () => {
    const html = renderNotes(
      '**Full Changelog**: https://github.com/parkerbrown98/gotalk-server/commits/v0.1.0',
    );
    expect(html).toBe(
      '<p><strong>Full Changelog</strong>: <a href="https://github.com/parkerbrown98/gotalk-server/commits/v0.1.0" rel="ugc nofollow noopener">https://github.com/parkerbrown98/gotalk-server/commits/v0.1.0</a></p>\n',
    );
  });

  it('demotes headings under the page headings', () => {
    expect(renderNotes("## What's Changed\n#### Detail")).toBe("<h3>What's Changed</h3>\n<h5>Detail</h5>\n");
    expect(renderNotes('# Top\n###### deep')).toBe('<h3>Top</h3>\n<h6>deep</h6>\n');
  });

  it('escapes HTML and drops dangerous links', () => {
    const html = renderNotes(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) [data](data:text/html,hi)',
    );
    expect(html).not.toMatch(/<script|<img|href="javascript|href="data/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('turns images into links, since the CSP only allows same-origin images', () => {
    expect(renderNotes('![screenshot](https://example.com/a.png)')).toBe(
      '<p><a href="https://example.com/a.png" rel="ugc nofollow noopener">screenshot</a></p>\n',
    );
    expect(renderNotes('![bad](javascript:alert(1))')).not.toContain('href');
  });
});

describe('verifySignature', () => {
  const body = new TextEncoder().encode('{"action":"published"}');
  const sign = (secret: string) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

  it('accepts the HMAC of the body with the shared secret', () => {
    expect(verifySignature('s3cret', body, sign('s3cret'))).toBe(true);
  });

  it.each([
    ['another secret', sign('other')],
    ['a missing header', null],
    ['the SHA-1 header format', 'sha1=' + 'a'.repeat(40)],
    ['a truncated signature', sign('s3cret').slice(0, 20)],
    ['non-hex junk', 'sha256=zz'],
  ])('rejects %s', (_, header) => {
    expect(verifySignature('s3cret', body, header)).toBe(false);
  });

  it('rejects everything without a secret', () => {
    expect(verifySignature('', body, sign(''))).toBe(false);
  });
});
