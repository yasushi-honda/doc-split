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
      // Issue #315 #1 (silent-failure-hunter I1 + C1): 素の process.env.NODE_ENV 代入を禁止し
      // withNodeEnv/withNodeEnvAsync helper 経由に強制する。helper 自身 (test/helpers/**) は
      // 次の override block で rule を無効化する。
      //
      // C1 対応: dot-access / computed property (bracket literal) / Object.assign による
      // process.env 変更の 3 経路を封じる。dynamic key (`process.env[key] = ...`) は selector で
      // 原理的に拾えないが、現実的な bypass path は本 rule で覆う。
      'no-restricted-syntax': [
        'error',
        {
          // 1. process.env.NODE_ENV = ... (dot access)
          selector:
            "AssignmentExpression[left.object.object.name='process'][left.object.property.name='env'][left.property.name='NODE_ENV']",
          message:
            "process.env.NODE_ENV への直接代入は禁止。undefined 文字列化 leak を防ぐため withNodeEnv / withNodeEnvAsync helper を使用してください (test/helpers/withNodeEnv.ts)。",
        },
        {
          // 2. process.env['NODE_ENV'] = ... (computed property with string literal)
          selector:
            "AssignmentExpression[left.computed=true][left.object.object.name='process'][left.object.property.name='env'][left.property.value='NODE_ENV']",
          message:
            "process.env['NODE_ENV'] への bracket 代入も禁止 (dot access と同じ silent failure リスク)。withNodeEnv / withNodeEnvAsync helper を使用してください。",
        },
        {
          // 3. Object.assign(process.env, { ... }) — bulk mutation
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name='assign'][arguments.0.type='MemberExpression'][arguments.0.object.name='process'][arguments.0.property.name='env']",
          message:
            "Object.assign(process.env, ...) による process.env 変更も禁止。withNodeEnv / withNodeEnvAsync helper を使用してください。",
        },
      ],
    },
  },
  {
    // helper 自身は rule 対象外 (helper 実装が process.env.NODE_ENV を直接代入する必要がある)。
    // glob が `test/helpers/**/*.ts` と広いため、将来 env-mutation helper を追加する際は
    // 明示レビューで本 rule の無効化妥当性を確認すること (review-pr comment-analyzer Important)。
    files: ['test/helpers/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
