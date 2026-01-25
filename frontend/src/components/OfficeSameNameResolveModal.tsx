/**
 * 事業所同名解決モーダル
 *
 * 機能:
 * - 書類情報の表示
 * - 事業所候補リストからの選択
 * - 「該当なし」選択
 * - 確定処理
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertCircle, FileText, Building2, Calendar, Check, BookMarked } from 'lucide-react';
import { useOfficeResolution } from '@/hooks/useOfficeResolution';
import { useMasterAlias } from '@/hooks/useMasterAlias';
import { RegisterNewMasterModal, type RegisteredMasterInfo } from '@/components/RegisterNewMasterModal';
import type { Document, OfficeCandidateInfo } from '@shared/types';

// ============================================
// 型定義
// ============================================

interface OfficeSameNameResolveModalProps {
  document: Document;
  isOpen: boolean;
  onClose: () => void;
  onResolved?: () => void;
}

type SelectionType = 'candidate' | 'unknown' | null;

interface Selection {
  type: SelectionType;
  candidate?: OfficeCandidateInfo;
}

// 登録提案ダイアログの状態
type RegistrationPromptState = 'none' | 'prompt' | 'registering';

// ============================================
// マッチタイプ表示
// ============================================

const matchTypeLabels: Record<string, string> = {
  exact: '完全一致',
  partial: '部分一致',
  fuzzy: '類似度マッチ',
};

function MatchTypeBadge({ matchType }: { matchType: string }) {
  return (
    <Badge variant="secondary" className="text-xs">
      {matchTypeLabels[matchType] || matchType}
    </Badge>
  );
}

// ============================================
// 候補カード
// ============================================

interface CandidateCardProps {
  candidate: OfficeCandidateInfo;
  isSelected: boolean;
  onSelect: () => void;
}

function CandidateCard({ candidate, isSelected, onSelect }: CandidateCardProps) {
  return (
    <Card
      className={`cursor-pointer transition-colors ${
        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <RadioGroupItem
            value={candidate.officeId}
            checked={isSelected}
            className="mt-1"
          />
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{candidate.officeName}</span>
              {candidate.shortName && (
                <span className="text-sm text-muted-foreground">
                  ({candidate.shortName})
                </span>
              )}
              {candidate.isDuplicate && (
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                  同名
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>スコア: {candidate.score}</span>
              <MatchTypeBadge matchType={candidate.matchType} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// メインコンポーネント
// ============================================

export function OfficeSameNameResolveModal({
  document,
  isOpen,
  onClose,
  onResolved,
}: OfficeSameNameResolveModalProps) {
  const {
    resolveOffice,
    resolveAsUnknown,
    isResolving,
    resolveError,
    getCandidates,
  } = useOfficeResolution();

  const { addAlias, isAdding } = useMasterAlias();

  // 選択状態
  const [selection, setSelection] = useState<Selection>({ type: null });

  // 「この表記を記憶する」チェック状態
  const [rememberNotation, setRememberNotation] = useState(false);

  // 登録提案ダイアログの状態
  const [registrationPrompt, setRegistrationPrompt] = useState<RegistrationPromptState>('none');

  // 候補リスト
  const candidates = getCandidates(document);

  // ファイル名から抽出された事業所名（優先）またはOCRから抽出された事業所名
  const suggestedNewOffice = document.suggestedNewOffice;
  const suggestedOfficeName = suggestedNewOffice || document.officeName || '';

  // モーダル開閉時にリセット
  useEffect(() => {
    if (isOpen) {
      setSelection({ type: null });
      setRegistrationPrompt('none');
      setRememberNotation(false);
    }
  }, [isOpen]);

  // 候補選択
  const handleSelectCandidate = useCallback((candidate: OfficeCandidateInfo) => {
    setSelection({ type: 'candidate', candidate });
  }, []);

  // 該当なし選択
  const handleSelectUnknown = useCallback(() => {
    setSelection({ type: 'unknown' });
  }, []);

  // 確定処理
  const handleConfirm = useCallback(async () => {
    if (!selection.type) return;

    try {
      if (selection.type === 'candidate' && selection.candidate) {
        // 「この表記を記憶する」がチェックされている場合、エイリアスを追加
        if (rememberNotation && suggestedNewOffice) {
          await addAlias('office', selection.candidate.officeId, suggestedNewOffice);
        }

        await resolveOffice({
          documentId: document.id,
          selectedOfficeId: selection.candidate.officeId,
          selectedOfficeName: selection.candidate.officeName,
          selectedOfficeIsDuplicate: selection.candidate.isDuplicate,
        });
        onResolved?.();
        onClose();
      } else if (selection.type === 'unknown') {
        // 「該当なし」選択時は登録提案ダイアログを表示
        setRegistrationPrompt('prompt');
      }
    } catch (err) {
      // エラーはresolveErrorで表示
      console.error('Resolution failed:', err);
    }
  }, [selection, document.id, resolveOffice, onResolved, onClose, rememberNotation, suggestedNewOffice, addAlias]);

  // 登録せずに確定（不明事業所として登録）
  const handleSkipRegistration = useCallback(async () => {
    try {
      await resolveAsUnknown({ documentId: document.id });
      onResolved?.();
      onClose();
    } catch (err) {
      console.error('Resolution failed:', err);
    }
  }, [document.id, resolveAsUnknown, onResolved, onClose]);

  // 新規登録後のコールバック
  const handleMasterRegistered = useCallback(
    async (result: RegisteredMasterInfo) => {
      // 登録後、その事業所で確定する
      try {
        await resolveOffice({
          documentId: document.id,
          selectedOfficeId: result.id || result.name, // IDがない場合は名前で代用
          selectedOfficeName: result.name,
          selectedOfficeIsDuplicate: false,
        });
        onResolved?.();
        onClose();
      } catch (err) {
        console.error('Resolution after registration failed:', err);
      }
    },
    [document.id, resolveOffice, onResolved, onClose]
  );

  // 書類日付フォーマット
  const formattedDate = document.fileDate
    ? document.fileDate.toDate().toLocaleDateString('ja-JP')
    : document.processedAt.toDate().toLocaleDateString('ja-JP');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>事業所の確定</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* 書類情報 */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">書類情報</h3>
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">ファイル名:</span>
                  <span className="text-sm">{document.fileName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">書類種別:</span>
                  <span className="text-sm">{document.documentType || '不明'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">書類日付:</span>
                  <span className="text-sm">{formattedDate}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 事業所候補選択 */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              事業所候補を選択してください
            </h3>
            <RadioGroup
              value={
                selection.type === 'candidate'
                  ? selection.candidate?.officeId
                  : selection.type === 'unknown'
                  ? 'unknown'
                  : ''
              }
            >
              <div className="space-y-3">
                {/* 候補リスト */}
                {candidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.officeId}
                    candidate={candidate}
                    isSelected={
                      selection.type === 'candidate' &&
                      selection.candidate?.officeId === candidate.officeId
                    }
                    onSelect={() => handleSelectCandidate(candidate)}
                  />
                ))}

                {/* 該当なし選択 */}
                <Card
                  className={`cursor-pointer transition-colors ${
                    selection.type === 'unknown'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={handleSelectUnknown}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <RadioGroupItem
                        value="unknown"
                        checked={selection.type === 'unknown'}
                      />
                      <div className="flex-1">
                        <span className="font-medium text-muted-foreground">
                          該当なし（事業所として登録しない）
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </RadioGroup>
          </div>

          {/* 表記記憶オプション */}
          {selection.type === 'candidate' && suggestedNewOffice && selection.candidate && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="remember-notation"
                    checked={rememberNotation}
                    onCheckedChange={(checked) => setRememberNotation(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <label
                      htmlFor="remember-notation"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      <BookMarked className="h-4 w-4 text-blue-600" />
                      この表記を記憶する
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      「{suggestedNewOffice}」を「{selection.candidate.officeName}」の
                      許容表記として登録します。次回から自動的にマッチします。
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* エラー表示 */}
          {resolveError && (
            <Card className="border-destructive">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">
                    エラー: {(resolveError as Error).message}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isResolving}>
            キャンセル
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selection.type || isResolving || isAdding}
          >
            {isResolving || isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                処理中...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                確定する
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 登録提案ダイアログ */}
      {registrationPrompt === 'prompt' && (
        <Dialog open={true} onOpenChange={() => setRegistrationPrompt('none')}>
          <DialogContent className="max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>新規事業所の登録</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                該当する事業所がマスターに登録されていない可能性があります。
                新しい事業所として登録しますか？
              </p>
              {suggestedNewOffice && (
                <Card className="bg-green-50 border-green-200">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm">
                        ファイル名から抽出: <strong className="text-green-700">{suggestedNewOffice}</strong>
                      </span>
                    </div>
                    <p className="text-xs text-green-600 mt-1">
                      ※ファイル名とOCRテキスト両方に存在を確認済み
                    </p>
                  </CardContent>
                </Card>
              )}
              {!suggestedNewOffice && suggestedOfficeName && suggestedOfficeName !== '不明事業所' && suggestedOfficeName !== '未判定' && (
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        OCR抽出値: <strong>{suggestedOfficeName}</strong>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={handleSkipRegistration}
                disabled={isResolving}
                className="w-full sm:w-auto"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    処理中...
                  </>
                ) : (
                  '登録せずに確定'
                )}
              </Button>
              <Button
                onClick={() => setRegistrationPrompt('registering')}
                disabled={isResolving}
                className="w-full sm:w-auto"
              >
                <Building2 className="h-4 w-4 mr-2" />
                新規登録する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* 新規マスター登録モーダル */}
      <RegisterNewMasterModal
        type="office"
        isOpen={registrationPrompt === 'registering'}
        onClose={() => setRegistrationPrompt('prompt')}
        suggestedName={suggestedNewOffice || (suggestedOfficeName !== '不明事業所' && suggestedOfficeName !== '未判定' ? suggestedOfficeName : '')}
        onRegistered={handleMasterRegistered}
      />
    </Dialog>
  );
}
