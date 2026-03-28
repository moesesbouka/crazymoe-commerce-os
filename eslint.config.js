const js = require('@eslint/js');

module.exports = [
  {
    ignores: [
      '**/*.html',
      'moe-inventory/api/ocr-proxy.example.js'
    ]
  },

  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: {
        require: 'readonly',
        module: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        console: 'readonly',
        chrome: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        getComputedStyle: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLInputElement: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        DataTransfer: 'readonly',
        location: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly'
      }
    },
    rules: {
      'no-useless-escape': 'off',
      'no-empty': 'off',
      'no-unused-vars': 'off'
    }
  }
];
