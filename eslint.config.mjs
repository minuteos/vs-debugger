import eslint from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import jsdoc from 'eslint-plugin-jsdoc'
import perfectionist from 'eslint-plugin-perfectionist'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  jsdoc.configs['flat/contents-typescript-error'],
  jsdoc.configs['flat/logical-typescript-error'],
  jsdoc.configs['flat/stylistic-typescript-error'],
  stylistic.configs.customize({
    quotes: 'single',
    braceStyle: '1tbs',
  }),
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
      },
      ecmaVersion: 2022,
      sourceType: 'module',
    },

    plugins: { perfectionist },

    rules: {
      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-imports': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
)
