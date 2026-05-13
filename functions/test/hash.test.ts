/**
 * sha256Hex helper の単体テスト。
 * Issue #445 PR-D2 review で `crypto.createHash('sha256').update(buf).digest('hex')` の
 * inline 重複を排除するために導入した共通 helper のカバレッジ。
 */

import { expect } from 'chai';
import { sha256Hex } from '../src/utils/hash';

describe('sha256Hex', () => {
  it('既知の入力に対する RFC ベクトル ("abc") を 64 桁 hex で返す', () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const result = sha256Hex(Buffer.from('abc'));
    expect(result).to.equal(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('空 buffer は既知の hash を返す (RFC 6234)', () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const result = sha256Hex(Buffer.alloc(0));
    expect(result).to.equal(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('Uint8Array を直接受け取って Buffer と同じ結果を返す (pdf-lib 互換)', () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // 'abc'
    const fromUint8 = sha256Hex(bytes);
    const fromBuffer = sha256Hex(Buffer.from('abc'));
    expect(fromUint8).to.equal(fromBuffer);
  });

  it('戻り値は常に 64 桁 lowercase hex', () => {
    const result = sha256Hex(Buffer.from('test'));
    expect(result).to.have.lengthOf(64);
    expect(result).to.match(/^[0-9a-f]{64}$/);
  });
});
