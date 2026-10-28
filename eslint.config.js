import eslintPluginAstro from "eslint-plugin-astro";

export default [
  {
    ignores: ["dist/**", ".astro/**", "node_modules/**", ".lighthouseci/**"],
  },
  ...eslintPluginAstro.configs.recommended,
];
