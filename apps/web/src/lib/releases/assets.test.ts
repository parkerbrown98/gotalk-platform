import { describe, expect, it } from 'vitest';

import { clientRelease, serverRelease } from '../../../test/fake-github.ts';
import {
  classifyClientAsset,
  classifyServerAsset,
  downloadsByOs,
  formatSize,
  otherAssets,
  selectRelease,
} from './assets.ts';
import { normalizeReleases } from './github.ts';
import type { ReleaseAsset } from './types.ts';

const asset = (name: string): ReleaseAsset => ({ name, size: 1, url: `https://x/${name}` });

describe('classifyClientAsset', () => {
  it.each([
    ['Gotalk_0.1.0_aarch64.dmg', 'macos', 'arm64', 'Apple silicon', true],
    ['Gotalk_0.1.0_x64.dmg', 'macos', 'x64', 'Intel', true],
    ['Gotalk_0.1.0_x64-setup.exe', 'windows', 'x64', 'Installer', true],
    ['Gotalk_0.1.0_x64_en-US.msi', 'windows', 'x64', 'MSI package', false],
    ['Gotalk_0.1.0_amd64.AppImage', 'linux', 'x64', 'AppImage', true],
    ['Gotalk_0.1.0_amd64.deb', 'linux', 'x64', 'Debian and Ubuntu', false],
    ['Gotalk-0.1.0-1.x86_64.rpm', 'linux', 'x64', 'Fedora and openSUSE', false],
    ['Gotalk_0.1.0_aarch64.AppImage', 'linux', 'arm64', 'AppImage', true],
  ])('%s', (name, os, arch, label, primary) => {
    expect(classifyClientAsset(asset(name))).toMatchObject({ os, arch, label, primary });
  });

  it.each([
    'Gotalk_aarch64.app.tar.gz',
    'Gotalk_x64.app.tar.gz',
    'Gotalk_0.1.0_x64-setup.exe.sig',
    'latest.json',
    'Gotalk.dmg',
  ])('skips %s', (name) => expect(classifyClientAsset(asset(name))).toBeNull());
});

describe('classifyServerAsset', () => {
  it.each([
    ['gotalk-server_0.1.0-beta.1_darwin_arm64.tar.gz', 'macos', 'arm64', 'Apple silicon', '.tar.gz'],
    ['gotalk-server_0.1.0-beta.1_darwin_amd64.tar.gz', 'macos', 'x64', 'Intel', '.tar.gz'],
    ['gotalk-server_0.1.0-beta.1_linux_arm64.tar.gz', 'linux', 'arm64', 'ARM64', '.tar.gz'],
    ['gotalk-server_0.1.0-beta.1_linux_amd64.tar.gz', 'linux', 'x64', 'x86-64', '.tar.gz'],
    ['gotalk-server_0.1.0-beta.1_windows_amd64.zip', 'windows', 'x64', 'x86-64', '.zip'],
  ])('%s', (name, os, arch, label, format) => {
    expect(classifyServerAsset(asset(name))).toMatchObject({ os, arch, label, format });
  });

  it('skips checksums.txt', () => expect(classifyServerAsset(asset('checksums.txt'))).toBeNull());
});

describe('downloadsByOs', () => {
  it('groups by OS with the primary file first and packages in a fixed order', () => {
    const [release] = normalizeReleases([clientRelease('0.1.0')]);
    const groups = downloadsByOs(release, classifyClientAsset);
    expect(groups.map((g) => [g.os, g.downloads.map((d) => d.asset.name)])).toEqual([
      ['macos', ['Gotalk_0.1.0_aarch64.dmg', 'Gotalk_0.1.0_x64.dmg']],
      ['windows', ['Gotalk_0.1.0_x64-setup.exe', 'Gotalk_0.1.0_x64_en-US.msi']],
      ['linux', ['Gotalk_0.1.0_amd64.AppImage', 'Gotalk_0.1.0_amd64.deb', 'Gotalk-0.1.0-1.x86_64.rpm']],
    ]);
    expect(otherAssets(release, classifyClientAsset).map((a) => a.name)).toEqual([
      'Gotalk_aarch64.app.tar.gz',
    ]);
  });

  it('lists server binaries by OS', () => {
    const [release] = normalizeReleases([serverRelease('0.1.0')]);
    expect(downloadsByOs(release, classifyServerAsset).map((g) => [g.os, g.downloads.length])).toEqual([
      ['macos', 2],
      ['windows', 1],
      ['linux', 2],
    ]);
  });
});

describe('selectRelease', () => {
  const releases = (...list: Parameters<typeof clientRelease>[]) =>
    normalizeReleases(list.map((a) => clientRelease(...a)));

  it('shows the newest beta when there is no stable release, with no toggle', () => {
    const list = releases(['0.1.0-beta.2', { day: 5 }], ['0.1.0-beta.1', { day: 1 }]);
    expect(selectRelease(list, classifyClientAsset)).toMatchObject({
      channel: 'beta',
      hasChoice: false,
      release: { tag: 'v0.1.0-beta.2' },
    });
    expect(selectRelease(list, classifyClientAsset, 'beta').release?.tag).toBe('v0.1.0-beta.2');
  });

  it('prefers stable, and offers a newer beta on request', () => {
    const list = releases(['0.2.0-beta.1', { day: 9 }], ['0.1.0', { day: 5 }], ['0.1.0-beta.3', { day: 1 }]);
    expect(selectRelease(list, classifyClientAsset)).toMatchObject({
      channel: 'stable',
      hasChoice: true,
      release: { tag: 'v0.1.0' },
    });
    expect(selectRelease(list, classifyClientAsset, 'beta')).toMatchObject({
      channel: 'beta',
      release: { tag: 'v0.2.0-beta.1' },
    });
  });

  it('ignores a beta older than the stable release', () => {
    const list = releases(['0.2.0', { day: 9 }], ['0.2.0-rc.1', { day: 5 }]);
    expect(selectRelease(list, classifyClientAsset, 'beta')).toMatchObject({
      channel: 'stable',
      hasChoice: false,
    });
  });

  it('skips a release whose files have not been uploaded yet', () => {
    const list = releases(['0.3.0', { day: 9, assets: [] }], ['0.2.0', { day: 5 }]);
    expect(selectRelease(list, classifyClientAsset).release?.tag).toBe('v0.2.0');
  });

  it('returns nothing without releases', () => {
    expect(selectRelease([], classifyClientAsset)).toEqual({
      release: undefined,
      channel: undefined,
      hasChoice: false,
    });
  });
});

describe('formatSize', () => {
  it.each([
    [84_703_736, '80.8 MB'],
    [561, '561 B'],
    [4096, '4 KB'],
  ])('%d bytes is %s', (n, s) => expect(formatSize(n)).toBe(s));
});
