import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generates a stylesheet of `--gt-*` custom properties from `@gotalk/tokens`, the client's design tokens.
 *
 * The package ships TypeScript sources only, and Node will not strip types inside `node_modules`, so the
 * sources are copied to a temporary directory and imported from there.
 *
 * @param {string} outFile
 */
export async function writeTokensCss(outFile) {
  const srcDir = dirname(fileURLToPath(import.meta.resolve('@gotalk/tokens')));
  const tmp = mkdtempSync(join(tmpdir(), 'gotalk-tokens-'));
  try {
    for (const name of readdirSync(srcDir)) {
      if (name.endsWith('.ts') && !name.endsWith('.test.ts'))
        copyFileSync(join(srcDir, name), join(tmp, name));
    }
    const { theme } = await import(pathToFileURL(join(tmp, 'theme.ts')).href);
    const { toCss } = await import(pathToFileURL(join(tmp, 'css.ts')).href);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(
      outFile,
      '/* Generated from @gotalk/tokens by integrations/tokens.mjs. Do not edit. */\n' + toCss(theme),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** @returns {import('astro').AstroIntegration} */
export default function gotalkTokens() {
  return {
    name: 'gotalk-tokens',
    hooks: {
      'astro:config:setup': async ({ config, logger }) => {
        await writeTokensCss(fileURLToPath(new URL('./src/styles/generated/tokens.css', config.root)));
        logger.info('wrote src/styles/generated/tokens.css');
      },
    },
  };
}
