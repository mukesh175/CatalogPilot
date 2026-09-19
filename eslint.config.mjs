import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends('next/core-web-vitals'),
  {
    ignores: ['.next/**', 'node_modules/**', 'prisma/migrations/**'],
  },
  {
    rules: {
      // Product images come from arbitrary supplier URLs, which next/image
      // cannot optimize without configuring every possible remote host.
      '@next/next/no-img-element': 'off',
    },
  },
];

export default config;
