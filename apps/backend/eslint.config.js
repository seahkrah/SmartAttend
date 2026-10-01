// ESLint for the API. Rules that find bugs are errors; style and the
// codebase's widespread `any` are not this config's job (TypeScript strictness
// is tracked separately). `npm run lint` must report 0 errors.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.file-storage/**', '.e2e-fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // 631 uses. Tightening `any` is the strict-TypeScript work, tracked in
      // the scorecard (strict-ts-backend), not a lint error.
      '@typescript-eslint/no-explicit-any': 'off',
      // Express's Request augmentation is declared with `declare global { namespace Express }`.
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
)
