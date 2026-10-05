export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.astro/**',
      'artifacts/**',
      'public/assets/**',
    ],
  },
  {
    files: ['**/*.mjs', 'src/scripts/*.js', 'src/pages/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-constant-condition': 'error',
      'no-unreachable': 'error',
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-duplicate-imports': 'error',
    },
  },
];
