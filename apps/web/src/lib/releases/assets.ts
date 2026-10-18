import type { Release, ReleaseAsset } from './types.ts';

export type Os = 'macos' | 'windows' | 'linux';
export type Arch = 'arm64' | 'x64';

export const osNames: Record<Os, string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

export interface Download {
  os: Os;
  arch: Arch;
  /** What the file is, for example "Apple silicon" or "Debian and Ubuntu". */
  label: string;
  /** File type shown next to the label, for example ".dmg". */
  format: string;
  /** The file most people on this OS and architecture want. */
  primary: boolean;
  asset: ReleaseAsset;
}

function archOf(name: string): Arch | undefined {
  if (/(^|[_.-])(aarch64|arm64)([_.-]|$)/.test(name)) return 'arm64';
  if (/(^|[_.-])(x86_64|x64|amd64)([_.-]|$)/.test(name)) return 'x64';
  return undefined;
}

/**
 * Classifies a desktop installer from a `gotalk-client` release (Tauri bundle names, such as
 * `Gotalk_0.1.0_aarch64.dmg` or `Gotalk_0.1.0_x64-setup.exe`). Updater bundles and signatures are skipped.
 */
export function classifyClientAsset(asset: ReleaseAsset): Download | null {
  const name = asset.name.toLowerCase();
  if (name.endsWith('.sig') || name.endsWith('.app.tar.gz') || name.endsWith('.json')) return null;
  const arch = archOf(name);
  if (!arch) return null;
  const d = (os: Os, label: string, format: string, primary: boolean): Download => ({
    os,
    arch,
    label,
    format,
    primary,
    asset,
  });
  if (name.endsWith('.dmg')) return d('macos', arch === 'arm64' ? 'Apple silicon' : 'Intel', '.dmg', true);
  if (name.endsWith('.exe')) return d('windows', 'Installer', '.exe', true);
  if (name.endsWith('.msi')) return d('windows', 'MSI package', '.msi', false);
  if (name.endsWith('.appimage')) return d('linux', 'AppImage', '.AppImage', true);
  if (name.endsWith('.deb')) return d('linux', 'Debian and Ubuntu', '.deb', false);
  if (name.endsWith('.rpm')) return d('linux', 'Fedora and openSUSE', '.rpm', false);
  return null;
}

/**
 * Classifies a server binary archive from a `gotalk-server` release, such as
 * `gotalk-server_0.1.0-beta.1_linux_arm64.tar.gz`.
 */
export function classifyServerAsset(asset: ReleaseAsset): Download | null {
  const m = /_(linux|darwin|windows)_(amd64|arm64)\.(tar\.gz|zip)$/i.exec(asset.name);
  if (!m) return null;
  const os: Os = m[1].toLowerCase() === 'darwin' ? 'macos' : (m[1].toLowerCase() as Os);
  const arch: Arch = m[2].toLowerCase() === 'arm64' ? 'arm64' : 'x64';
  const label =
    arch === 'arm64' ? (os === 'macos' ? 'Apple silicon' : 'ARM64') : os === 'macos' ? 'Intel' : 'x86-64';
  return { os, arch, label, format: `.${m[3].toLowerCase()}`, primary: true, asset };
}

const osOrder: Os[] = ['macos', 'windows', 'linux'];
const formatOrder = ['.dmg', '.exe', '.msi', '.AppImage', '.deb', '.rpm', '.tar.gz', '.zip'];
const rank = (d: Download) => {
  const i = formatOrder.indexOf(d.format);
  return i < 0 ? formatOrder.length : i;
};

/** The classified files of a release, grouped by OS in display order, primary files first. */
export function downloadsByOs(
  release: Release,
  classify: (a: ReleaseAsset) => Download | null,
): { os: Os; downloads: Download[] }[] {
  const all = release.assets.map(classify).filter((d): d is Download => d !== null);
  return osOrder
    .map((os) => ({
      os,
      downloads: all
        .filter((d) => d.os === os)
        .sort(
          (a, b) =>
            Number(b.primary) - Number(a.primary) || rank(a) - rank(b) || a.arch.localeCompare(b.arch),
        ),
    }))
    .filter((g) => g.downloads.length > 0);
}

/** Files of a release the classifier does not place, such as checksum lists and updater bundles. */
export function otherAssets(
  release: Release,
  classify: (a: ReleaseAsset) => Download | null,
): ReleaseAsset[] {
  return release.assets.filter((a) => classify(a) === null);
}

export type Channel = 'stable' | 'beta';

export interface Selection {
  release?: Release;
  /** The channel `release` is on. */
  channel?: Channel;
  /** A beta newer than the stable release exists, so a toggle between the two makes sense. */
  hasChoice: boolean;
}

/**
 * Picks the release to show. The stable channel is the newest non-prerelease. The beta channel is the newest
 * pre-release if it is newer than that. Without a stable release, the beta is shown either way. Releases
 * without any recognized file (for example, published before the uploads finished) are skipped.
 */
export function selectRelease(
  releases: Release[],
  classify: (a: ReleaseAsset) => Download | null,
  wanted: Channel = 'stable',
): Selection {
  const usable = (r: Release) => r.assets.some((a) => classify(a) !== null);
  const stable = releases.find((r) => !r.prerelease && usable(r));
  const pre = releases.find((r) => r.prerelease && usable(r));
  const beta = pre && (!stable || pre.publishedAt > stable.publishedAt) ? pre : undefined;
  const hasChoice = Boolean(stable && beta);
  const release = wanted === 'beta' ? (beta ?? stable) : (stable ?? beta);
  return { release, channel: release ? (release.prerelease ? 'beta' : 'stable') : undefined, hasChoice };
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
