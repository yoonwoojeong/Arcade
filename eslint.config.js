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
    files: ['web/**/*.js', 'games/**/*.js', 'templates/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
