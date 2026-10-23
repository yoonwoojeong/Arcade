import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'test-results/', 'playwright-report/', '.superpowers/'] },
  js.configs.recommended,
  {
    files: ['hooks/**/*.js', 'server/**/*.js', 'scripts/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright fixtures must destructure their first argument, even when it is unused.
    files: ['test/e2e/**/*.js'],
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['web/**/*.js', 'games/**/*.js', 'templates/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
