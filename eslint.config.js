import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/',
      '**/.astro/',
      '**/node_modules/',
      'apps/web/src/styles/generated/',
      'apps/web/src/generated/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  astro.configs['jsx-a11y-recommended'],
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    // Maintainer scripts drive Chromium and pass functions to page.evaluate().
    files: ['apps/web/scripts/**'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Safari drops list semantics from lists styled with `list-style: none` unless role="list" is set.
    files: ['**/*.astro'],
    rules: { 'astro/jsx-a11y/no-redundant-roles': ['error', { ul: ['list'] }] },
  },
);
