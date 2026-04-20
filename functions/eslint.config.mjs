import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['lib', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-control-regex': 'warn',
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
        ...globals.mocha,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-control-regex': 'warn',
      // Issue #315 #1 (silent-failure-hunter I1): 素の process.env.NODE_ENV 代入を禁止し
      // withNodeEnv/withNodeEnvAsync helper 経由に強制する。helper 自身 (test/helpers/**) は
      // 次の override block で rule を無効化する。
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.object.object.name='process'][left.object.property.name='env'][left.property.name='NODE_ENV']",
          message:
            "process.env.NODE_ENV への直接代入は禁止。undefined 文字列化 leak を防ぐため withNodeEnv / withNodeEnvAsync helper を使用してください (test/helpers/withNodeEnv.ts)。",
        },
      ],
    },
  },
  {
    // helper 自身は rule 対象外 (helper 実装が process.env.NODE_ENV を直接代入する必要がある)。
    files: ['test/helpers/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
