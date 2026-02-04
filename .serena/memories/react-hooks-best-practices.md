# React Hooks ベストプラクティス

## useCallback/useMemo の定義順序

### 問題
`useCallback`の依存配列に`useMemo`の値を含める場合、定義順序を間違えると「Cannot access before initialization」エラーが発生する。

### ルール
**依存される値（useMemo）を先に、依存する関数（useCallback）を後に定義する**

```typescript
// ❌ NG: 初期化前参照エラー
const handleSelectAll = useCallback(() => {
  doSomething(documents)  // documentsがまだ未定義
}, [documents])

const documents = useMemo(() => {...}, [...])

// ✅ OK: 正しい順序
const documents = useMemo(() => {...}, [...])

const handleSelectAll = useCallback(() => {
  doSomething(documents)
}, [documents])
```

### チェックリスト（コードレビュー時）
- [ ] useCallbackの依存配列にuseMemoの値が含まれていないか確認
- [ ] 含まれている場合、useMemoが先に定義されているか確認
- [ ] ESLintの`react-hooks/exhaustive-deps`警告を確認

### 発生事例
- 2026-02-01: DocumentsPage.tsx - handleSelectAllがdocumentsより前に定義されてエラー
