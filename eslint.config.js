module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      'admin/vendor/**',
      'cloudfunctions/moodsky/shared/**',
      'miniprogram/config/environment.local.js',
    ],
  },
  {
    files: ['**/*.js', 'tools/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        Component: 'readonly',
        wx: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-eval': 'error',
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: ['miniprogram/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='database']",
          message: 'Business data must go through services/api.js and cloud authorization.',
        },
      ],
    },
  },
];
