export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "**/*.wasm",
      "**/*.vsix"
    ]
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-unused-vars": "off"
    }
  }
];
