module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  globals: {
    process: "readonly",
  },
  extends: "eslint:recommended",
  rules: {
    "import/no-unresolved": "off",
  },
};
