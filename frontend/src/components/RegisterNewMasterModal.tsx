/**
 * 新規マスター登録モーダル
 *
 * 同名解決モーダルで「該当なし」選択時に、
 * マスターデータへの新規登録を提案するモーダル
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, AlertCircle, Plus, UserPlus, Building2, FileText } from 'lucide-react';
import {
  useAddCustomer,
  useAddOffice,
  useAddDocumentType,
  useCareManagers,
  useDocumentTypes,
  checkCustomerDuplicate,
  checkOfficeDuplicate,
  DuplicateError,
} from '@/hooks/useMasters';

// ============================================
// 型定義
// ============================================

export type MasterType = 'customer' | 'office' | 'documentType';

interface RegisterNewMasterModalProps {
  type: MasterType;
  isOpen: boolean;
  onClose: () => void;
  /** OCRで抽出された名前（初期値） */
  suggestedName?: string;
  /** 登録成功時のコールバック */
  onRegistered?: (result: RegisteredMasterInfo) => void;
}

export interface RegisteredMasterInfo {
  type: MasterType;
  id: string;
  name: string;
}

// ============================================
// メインコンポーネント
// ============================================

export function RegisterNewMasterModal({
  type,
  isOpen,
  onClose,
  suggestedName = '',
  onRegistered,
}: RegisterNewMasterModalProps) {
  // フォーム状態
  const [name, setName] = useState(suggestedName);
  const [furigana, setFurigana] = useState('');
  const [shortName, setShortName] = useState('');
  const [careManagerName, setCareManagerName] = useState('');
  const [notes, setNotes] = useState('');
  // 書類種別用
  const [dateMarker, setDateMarker] = useState('');
  const [category, setCategory] = useState('');
  const [keywords, setKeywords] = useState('');

  // 同名チェック状態
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);

  // エラー状態
  const [error, setError] = useState<string | null>(null);

  // ケアマネ一覧取得
  const { data: careManagers } = useCareManagers();
  // 書類種別一覧取得（カテゴリ抽出用）
  const { data: existingDocTypes } = useDocumentTypes();

  // ミューテーション
  const addCustomer = useAddCustomer();
  const addOffice = useAddOffice();
  const addDocumentType = useAddDocumentType();

  const isLoading = addCustomer.isPending || addOffice.isPending || addDocumentType.isPending;

  // 既存カテゴリの一覧を抽出
  const existingCategories = Array.from(
    new Set((existingDocTypes || []).map((d) => d.category).filter(Boolean))
  );

  // モーダル開閉時に初期化
  useEffect(() => {
    if (isOpen) {
      setName(suggestedName);
      setFurigana('');
      setShortName('');
      setCareManagerName('');
      setNotes('');
      setDateMarker('');
      setCategory('');
      setKeywords('');
      setError(null);
      setShowDuplicateConfirm(false);
    }
  }, [isOpen, suggestedName]);

  // 同名チェック
  const checkDuplicate = useCallback(async (): Promise<boolean> => {
    if (!name.trim()) return false;

    setIsDuplicateChecking(true);
    try {
      if (type === 'customer') {
        return await checkCustomerDuplicate(name);
      } else if (type === 'office') {
        return await checkOfficeDuplicate(name);
      } else {
        // 書類種別は同名チェックを既存データから確認
        return (existingDocTypes || []).some((d) => d.name === name.trim());
      }
    } finally {
      setIsDuplicateChecking(false);
    }
  }, [name, type, existingDocTypes]);

  // 登録処理
  const handleRegister = useCallback(
    async (force = false) => {
      if (!name.trim()) {
        setError('名前を入力してください');
        return;
      }

      setError(null);

      try {
        // 強制追加でない場合は同名チェック
        if (!force) {
          const isDuplicate = await checkDuplicate();
          if (isDuplicate) {
            setShowDuplicateConfirm(true);
            return;
          }
        }

        let createdId: string;
        if (type === 'customer') {
          createdId = await addCustomer.mutateAsync({
            name: name.trim(),
            furigana: furigana.trim(),
            isDuplicate: force,
            careManagerName: careManagerName || undefined,
            notes: notes.trim() || undefined,
            force,
          });
        } else if (type === 'office') {
          createdId = await addOffice.mutateAsync({
            name: name.trim(),
            shortName: shortName.trim() || undefined,
            force,
          });
        } else {
          // 書類種別
          const keywordsArray = keywords.trim()
            ? keywords.split(/[;；]/).map(k => k.trim()).filter(Boolean)
            : undefined;
          await addDocumentType.mutateAsync({
            name: name.trim(),
            dateMarker: dateMarker.trim() || '日付',
            category: category.trim() || 'その他',
            keywords: keywordsArray,
          });
          createdId = name.trim(); // 書類種別はnameがID
        }

        // 成功時のコールバック（作成されたIDを渡す）
        onRegistered?.({
          type,
          id: createdId,
          name: name.trim(),
        });

        onClose();
      } catch (err) {
        if (err instanceof DuplicateError) {
          setShowDuplicateConfirm(true);
        } else {
          setError(err instanceof Error ? err.message : '登録に失敗しました');
        }
      }
    },
    [name, furigana, shortName, careManagerName, notes, dateMarker, category, keywords, type, checkDuplicate, addCustomer, addOffice, addDocumentType, onRegistered, onClose]
  );

  // 同名確認後の強制登録
  const handleForceRegister = useCallback(() => {
    setShowDuplicateConfirm(false);
    handleRegister(true);
  }, [handleRegister]);

  // タイプに応じたラベル
  const typeLabel = type === 'customer' ? '顧客' : type === 'office' ? '事業所' : '書類種別';
  const TypeIcon = type === 'customer' ? UserPlus : type === 'office' ? Building2 : FileText;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TypeIcon className="h-5 w-5" />
            新規{typeLabel}を登録
          </DialogTitle>
          <DialogDescription>
            マスターデータに新しい{typeLabel}を登録します。
            登録後、この書類に自動的に紐付けられます。
          </DialogDescription>
        </DialogHeader>

        {/* 同名確認ダイアログ */}
        {showDuplicateConfirm ? (
          <div className="space-y-4">
            <Card className="border-yellow-500 bg-yellow-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-yellow-800">
                      同名の{typeLabel}が既に存在します
                    </p>
                    <p className="text-sm text-yellow-700">
                      「{name}」という名前の{typeLabel}は既に登録されています。
                      同名で登録しますか？
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDuplicateConfirm(false)}
                disabled={isLoading}
              >
                戻る
              </Button>
              <Button
                variant="default"
                onClick={handleForceRegister}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    登録中...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    同名で登録する
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 名前入力 */}
            <div className="space-y-2">
              <Label htmlFor="name">
                {typeLabel}名 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${typeLabel}名を入力`}
                disabled={isLoading}
              />
              {suggestedName && name !== suggestedName && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setName(suggestedName)}
                >
                  OCR抽出値「{suggestedName}」を使用
                </Button>
              )}
            </div>

            {/* 顧客の場合: フリガナ入力 */}
            {type === 'customer' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="furigana">
                    フリガナ
                    <Badge variant="secondary" className="ml-2 text-xs">
                      任意
                    </Badge>
                  </Label>
                  <Input
                    id="furigana"
                    value={furigana}
                    onChange={(e) => setFurigana(e.target.value)}
                    placeholder="フリガナを入力"
                    disabled={isLoading}
                  />
                </div>

                {/* 担当ケアマネ選択 */}
                <div className="space-y-2">
                  <Label htmlFor="careManager">
                    担当ケアマネ
                    <Badge variant="secondary" className="ml-2 text-xs">
                      任意
                    </Badge>
                  </Label>
                  <Select
                    value={careManagerName}
                    onValueChange={(v) => setCareManagerName(v === '__none__' ? '' : v)}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="ケアマネを選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">（未設定）</SelectItem>
                      {careManagers?.map((cm) => (
                        <SelectItem key={cm.id} value={cm.name}>
                          {cm.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* 区別用メモ */}
                <div className="space-y-2">
                  <Label htmlFor="notes">
                    区別用メモ（同姓同名対策）
                    <Badge variant="secondary" className="ml-2 text-xs">
                      任意
                    </Badge>
                  </Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="例: 北名古屋在住"
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    同姓同名の顧客を区別するための補足情報
                  </p>
                </div>
              </>
            )}

            {/* 事業所の場合: 短縮名入力 */}
            {type === 'office' && (
              <div className="space-y-2">
                <Label htmlFor="shortName">
                  短縮名
                  <Badge variant="secondary" className="ml-2 text-xs">
                    任意
                  </Badge>
                </Label>
                <Input
                  id="shortName"
                  value={shortName}
                  onChange={(e) => setShortName(e.target.value)}
                  placeholder="短縮名を入力"
                  disabled={isLoading}
                />
              </div>
            )}

            {/* 書類種別の場合: カテゴリ・日付マーカー入力 */}
            {type === 'documentType' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="category">
                    カテゴリ
                    <Badge variant="secondary" className="ml-2 text-xs">
                      任意
                    </Badge>
                  </Label>
                  <Select
                    value={category}
                    onValueChange={(v) => setCategory(v === '__custom__' ? '' : v)}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="カテゴリを選択または入力" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">（未設定 → その他）</SelectItem>
                      {existingCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="category-custom"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="新しいカテゴリを入力"
                    disabled={isLoading}
                    className="mt-1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateMarker">
                    日付マーカー
                    <Badge variant="secondary" className="ml-2 text-xs">
                      任意
                    </Badge>
                  </Label>
                  <Input
                    id="dateMarker"
                    value={dateMarker}
                    onChange={(e) => setDateMarker(e.target.value)}
                    placeholder="例: 作成日、発行日（未入力時は「日付」）"
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    書類の日付を表すラベル
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="keywords">
                    キーワード
                    <Badge variant="secondary" className="ml-2 text-xs">
                      任意
                    </Badge>
                  </Label>
                  <Input
                    id="keywords"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="例: 被保険者証;介護保険;要介護"
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">
                    セミコロン(;)区切りで複数指定可。OCRでの書類種別判定に使用
                  </p>
                </div>
              </>
            )}

            {/* エラー表示 */}
            {error && (
              <Card className="border-destructive bg-destructive/10">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">{error}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={isLoading}>
                キャンセル
              </Button>
              <Button
                onClick={() => handleRegister(false)}
                disabled={isLoading || isDuplicateChecking || !name.trim()}
              >
                {isLoading || isDuplicateChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isDuplicateChecking ? 'チェック中...' : '登録中...'}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    登録する
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
