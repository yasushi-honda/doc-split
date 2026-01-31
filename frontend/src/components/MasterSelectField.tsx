/**
 * マスター選択フィールド（新規追加機能付き）
 *
 * 編集モード時にマスターデータからの選択と新規追加を提供
 * OCR候補がある場合は優先表示
 */

import { useState } from 'react';
import { Plus, ChevronDown, Check, User, Building2, FileText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getDisplayName } from '@/utils/displayName';
import { RegisterNewMasterModal, type MasterType, type RegisteredMasterInfo } from './RegisterNewMasterModal';

// ============================================
// 型定義
// ============================================

export type MasterFieldType = 'customer' | 'office' | 'documentType';

export interface MasterItem {
  id: string;
  name: string;
  subText?: string; // フリガナ、短縮名など
  notes?: string;   // 区別用補足情報
  score?: number;   // OCRマッチスコア（候補表示用）
}

interface MasterSelectFieldProps {
  type: MasterFieldType;
  value: string;
  items: MasterItem[];
  suggestedItems?: MasterItem[]; // OCR候補（優先表示）
  onChange: (value: string, item?: MasterItem) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ============================================
// アイコン設定
// ============================================

const typeConfig: Record<MasterFieldType, { icon: typeof User; label: string; addLabel: string; suggestedLabel: string }> = {
  customer: { icon: User, label: '顧客', addLabel: '新規顧客を追加', suggestedLabel: 'OCR候補' },
  office: { icon: Building2, label: '事業所', addLabel: '新規事業所を追加', suggestedLabel: 'OCR候補' },
  documentType: { icon: FileText, label: '書類種別', addLabel: '新規書類種別を追加', suggestedLabel: 'OCR候補' },
};

// ============================================
// メインコンポーネント
// ============================================

export function MasterSelectField({
  type,
  value,
  items,
  suggestedItems,
  onChange,
  placeholder = '選択してください',
  disabled = false,
}: MasterSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

  const config = typeConfig[type];

  // 新規登録完了時のコールバック
  const handleRegistered = (result: RegisteredMasterInfo) => {
    onChange(result.name, { id: result.id, name: result.name });
    setIsRegisterModalOpen(false);
  };

  // すべてのタイプで新規追加可能
  const canAddNew = true;
  const masterType: MasterType = type === 'customer' ? 'customer' : type === 'office' ? 'office' : 'documentType';

  // OCR候補のIDセット（重複除外用）
  const suggestedIds = new Set(suggestedItems?.map(item => item.id) || []);

  // OCR候補以外のアイテム
  const otherItems = items.filter(item => !suggestedIds.has(item.id));

  // 候補アイテムをレンダリング
  const renderItem = (item: MasterItem, showScore?: boolean) => {
    const displayText = getDisplayName(item.name, item.notes);
    return (
      <CommandItem
        key={item.id}
        value={displayText}
        onSelect={() => {
          onChange(item.name, item);
          setOpen(false);
        }}
      >
        <Check
          className={cn(
            "mr-2 h-4 w-4",
            value === item.name ? "opacity-100" : "opacity-0"
          )}
        />
        <div className="flex flex-col flex-1">
          <span>{displayText}</span>
          {item.subText && (
            <span className="text-xs text-muted-foreground">{item.subText}</span>
          )}
        </div>
        {showScore && item.score !== undefined && (
          <span className="text-xs text-muted-foreground ml-2">
            {item.score}%
          </span>
        )}
      </CommandItem>
    );
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-8 text-sm font-normal"
            disabled={disabled}
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value || placeholder}
            </span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`${config.label}を検索...`} />
            <CommandList className="max-h-[250px] overflow-y-auto">
              <CommandEmpty>該当なし</CommandEmpty>

              {/* OCR候補グループ（ある場合のみ表示） */}
              {suggestedItems && suggestedItems.length > 0 && (
                <>
                  <CommandGroup heading={
                    <span className="flex items-center gap-1 text-amber-600">
                      <Sparkles className="h-3 w-3" />
                      {config.suggestedLabel}
                    </span>
                  }>
                    {suggestedItems.map((item) => renderItem(item, true))}
                  </CommandGroup>
                  <CommandSeparator />
                </>
              )}

              {/* すべてのマスター（または候補以外） */}
              <CommandGroup heading={suggestedItems && suggestedItems.length > 0 ? "すべて" : undefined}>
                {otherItems.map((item) => renderItem(item, false))}
              </CommandGroup>
            </CommandList>
            {/* 新規追加ボタン（常に表示） */}
            {canAddNew && (
              <div className="border-t p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setIsRegisterModalOpen(true);
                  }}
                  className="w-full flex items-center px-2 py-1.5 text-sm text-primary hover:bg-accent rounded-sm cursor-pointer"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {config.addLabel}
                </button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {/* 新規マスター登録モーダル */}
      {canAddNew && (
        <RegisterNewMasterModal
          type={masterType}
          isOpen={isRegisterModalOpen}
          onClose={() => setIsRegisterModalOpen(false)}
          suggestedName={value !== '未判定' && value !== '不明顧客' && value !== '不明文書' ? value : ''}
          onRegistered={handleRegistered}
        />
      )}
    </>
  );
}
