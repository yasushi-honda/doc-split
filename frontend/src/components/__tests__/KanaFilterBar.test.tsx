/**
 * KanaFilterBar 単体テスト
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KanaFilterBar } from '../KanaFilterBar';

describe('KanaFilterBar', () => {
  it('「全」ボタンと10行のボタンを表示', () => {
    render(<KanaFilterBar selected={null} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '全' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'あ' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'か' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'さ' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'た' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'な' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'は' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'ま' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'や' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'ら' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'わ' })).toBeDefined();
  });

  it('selected=nullのとき「全」がアクティブ', () => {
    render(<KanaFilterBar selected={null} onSelect={vi.fn()} />);
    const allButton = screen.getByRole('button', { name: '全' });
    expect(allButton.getAttribute('data-active')).toBe('true');
  });

  it('selected="か"のとき「か」がアクティブ', () => {
    render(<KanaFilterBar selected="か" onSelect={vi.fn()} />);
    const kaButton = screen.getByRole('button', { name: 'か' });
    expect(kaButton.getAttribute('data-active')).toBe('true');
    const allButton = screen.getByRole('button', { name: '全' });
    expect(allButton.getAttribute('data-active')).toBe('false');
  });

  it('行ボタンクリックでonSelectが行を返す', () => {
    const onSelect = vi.fn();
    render(<KanaFilterBar selected={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'さ' }));
    expect(onSelect).toHaveBeenCalledWith('さ');
  });

  it('「全」クリックでonSelect(null)を返す', () => {
    const onSelect = vi.fn();
    render(<KanaFilterBar selected="か" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: '全' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('既に選択中の行をクリックするとnullを返す（トグル）', () => {
    const onSelect = vi.fn();
    render(<KanaFilterBar selected="た" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: 'た' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('disabled=trueのとき全ボタンが無効化される', () => {
    const onSelect = vi.fn();
    render(<KanaFilterBar selected={null} onSelect={onSelect} disabled={true} />);

    const allButton = screen.getByRole('button', { name: '全' });
    expect(allButton.hasAttribute('disabled')).toBe(true);

    const kaButton = screen.getByRole('button', { name: 'か' });
    expect(kaButton.hasAttribute('disabled')).toBe(true);

    // クリックしてもonSelectが呼ばれない
    fireEvent.click(kaButton);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disabled=falseのとき通常動作する', () => {
    const onSelect = vi.fn();
    render(<KanaFilterBar selected={null} onSelect={onSelect} disabled={false} />);

    const kaButton = screen.getByRole('button', { name: 'か' });
    expect(kaButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(kaButton);
    expect(onSelect).toHaveBeenCalledWith('か');
  });
});
