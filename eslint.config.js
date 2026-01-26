const js = require("@eslint/js");
const globals = require("globals");
//
module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node
      }
    },
    rules: {
      // Crytical errore.
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      //
      // Styles (from AGENTS.md).
      "quotes": ["error", "double", { "avoidEscape": true, "allowTemplateLiterals": false }],
      "indent": ["error", 2],
      "semi": ["error", "always"]
    }
  },
  {
    ignores: [
      "node_modules/**",
      "Configurations/**",
      "Credentials/**"
    ]
  }
];
