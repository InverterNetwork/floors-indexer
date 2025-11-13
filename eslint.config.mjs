import { defineConfig } from 'eslint/config'
import prettier from 'eslint-plugin-prettier'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import tseslint from 'typescript-eslint'

const basePlugins = {
  prettier: prettier,
  'simple-import-sort': simpleImportSort,
}

const baseRules = {
  'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
  'simple-import-sort/imports': 'error',
  'simple-import-sort/exports': 'error',
  'prettier/prettier': 'error',
}

export default defineConfig([
  // Ignore patterns
  {
    ignores: ['dist/**', 'node_modules/**', 'generated/**', 'build/**', '*.d.ts'],
  },
  // JavaScript/Config files
  {
    files: ['**/*.{mjs,cjs,js}'],
    plugins: basePlugins,
    rules: baseRules,
  },
  // TypeScript files
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: {
      ...basePlugins,
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...baseRules,
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
    },
  },
])
