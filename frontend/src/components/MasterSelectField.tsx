/**
 * マスター選択フィールド（新規追加機能付き）
 *
 * 編集モード時にマスターデータからの選択と新規追加を提供
 */

import { useState } from 'react';
import { Plus, ChevronDown, Check, User, Building2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
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
}

interface MasterSelectFieldProps {
  type: MasterFieldType;
  value: string;
  items: MasterItem[];
  onChange: (value: string, item?: MasterItem) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ============================================
// アイコン設定
// ============================================

const typeConfig: Record<MasterFieldType, { icon: typeof User; label: string; addLabel: string }> = {
  customer: { icon: User, label: '顧客', addLabel: '新規顧客を追加' },
  office: { icon: Building2, label: '事業所', addLabel: '新規事業所を追加' },
  documentType: { icon: FileText, label: '書類種別', addLabel: '新規書類種別を追加' },
};

// ============================================
// メインコンポーネント
// ============================================

export function MasterSelectField({
  type,
  value,
  items,
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
            <CommandList className="max-h-[200px] overflow-y-auto">
              <CommandEmpty>該当なし</CommandEmpty>
              <CommandGroup>
                {items.map((item) => {
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
                      <div className="flex flex-col">
                        <span>{displayText}</span>
                        {item.subText && (
                          <span className="text-xs text-muted-foreground">{item.subText}</span>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
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
