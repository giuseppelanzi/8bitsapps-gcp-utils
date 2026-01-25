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
      // Errori critici.
      "no-undef": "error",
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      //
      // Stile (come da AGENTS.md).
      "quotes": ["error", "double"],
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
