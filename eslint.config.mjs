import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/**
 * Lint configuration. The generated Prisma client and build output are excluded;
 * everything else follows the Next.js core-web-vitals and TypeScript presets.
 */
const config = [
  { ignores: ["src/generated/**", ".next/**", "node_modules/**", "storage*/**", "test-results/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

export default config;
