import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.beads', '.claude', '.codex', '.agents'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['src/astro/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react/*', 'react-dom', 'react-dom/*'], message: 'src/astro must stay framework-free.' },
            { group: ['three', 'three/*'], message: 'src/astro must not import three.' },
            { group: ['@react-three/*'], message: 'src/astro must not import @react-three.' },
            { group: ['@ui/*', '**/ui/*'], message: 'src/astro must not import UI code.' },
          ],
        },
      ],
    },
  },
);
