/**
 * ============================================
 * PDFページ回転 - メイン実行関数
 * 外部から呼び出し可能な統一インターフェース
 * ============================================
 */

/**
 * PDFページを回転させるメイン関数
 * 
 * @param {String} fileId - 必須: Google DriveのPDFファイルID
 * @param {String} mode - 必須: 回転モード ("single", "multiple", "range", "all", "even", "odd")
 * @param {Number} rotation - 必須: 回転角度 (90, 180, 270)
 * @param {Number|Array|String} pages - モードがsingle/multipleの場合必須: ページ番号（複数の場合はカンマ区切り文字列も可）
 * @param {Number} startPage - モードがrangeの場合必須: 開始ページ
 * @param {Number} endPage - モードがrangeの場合必須: 終了ページ
 * @param {Boolean} overwrite - オプション: 元ファイルを上書き (デフォルト: false)
 * @param {String} outputName - オプション: 出力ファイル名 (デフォルト: 自動生成)
 * 
 * @returns {Object} 処理結果 {success, fileId, fileName, url, message, error}
 */
async function rotatePDF(fileId, mode, rotation, pages, startPage, endPage, overwrite, outputName) {
  // 実行開始時刻
  const startTime = new Date();
  
  try {
    // ==================== 入力検証 ====================
    validateInputs(fileId, mode, rotation, pages, startPage, endPage);
    
    // デフォルト値の設定
    overwrite = overwrite || false;
    outputName = outputName || null;
    
    // pagesの型変換（文字列の場合）
    if (mode === 'multiple' && typeof pages === 'string') {
      pages = pages.split(',').map(p => parseInt(p.trim()));
    } else if (mode === 'single' && typeof pages === 'string') {
      pages = parseInt(pages);
    }
    
    // ==================== ログ出力 ====================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('PDF回転処理を開始します');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`ファイルID: ${fileId}`);
    console.log(`回転モード: ${mode}`);
    console.log(`回転角度: ${rotation}度`);
    console.log(`上書き: ${overwrite ? 'する' : 'しない'}`);
    
    // ==================== ファイル情報取得 ====================
    const originalFile = DriveApp.getFileById(fileId);
    const originalFileName = originalFile.getName();
    console.log(`対象ファイル: ${originalFileName}`);
    
    // ==================== モード別処理 ====================
    let result;
    let targetPages;
    
    switch (mode) {
      case 'single':
        // 単一ページ回転
        targetPages = pages;
        console.log(`対象ページ: ${pages}ページ目`);
        result = await rotatePdfPages(fileId, pages, rotation, overwrite);
        break;
        
      case 'multiple':
        // 複数ページ回転
        targetPages = Array.isArray(pages) ? pages : [pages];
        console.log(`対象ページ: ${targetPages.join(', ')}ページ目`);
        result = await rotatePdfPages(fileId, targetPages, rotation, overwrite);
        break;
        
      case 'range':
        // 範囲指定回転
        targetPages = [];
        for (let i = startPage; i <= endPage; i++) {
          targetPages.push(i);
        }
        console.log(`対象ページ: ${startPage}〜${endPage}ページ`);
        result = await rotatePdfPagesInRange(fileId, startPage, endPage, rotation, overwrite);
        break;
        
      case 'all':
        // 全ページ回転
        console.log('対象ページ: 全ページ');
        result = await rotateAllPages(fileId, rotation, overwrite);
        break;
        
      case 'even':
        // 偶数ページ回転
        console.log('対象ページ: 偶数ページ');
        result = await rotateEvenPages(fileId, rotation, overwrite);
        break;
        
      case 'odd':
        // 奇数ページ回転
        console.log('対象ページ: 奇数ページ');
        result = await rotateOddPages(fileId, rotation, overwrite);
        break;
        
      default:
        throw new Error(`不明なモード: ${mode}`);
    }
    
    // ==================== カスタムファイル名の設定 ====================
    if (outputName && !overwrite) {
      // 新規作成されたファイルの名前を変更
      result.setName(outputName);
      console.log(`ファイル名を変更: ${outputName}`);
    }
    
    // ==================== 処理時間計算 ====================
    const endTime = new Date();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);
    
    // ==================== 成功レスポンス ====================
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ 処理完了 (${processingTime}秒)`);
    console.log(`出力ファイル: ${result.getName()}`);
    console.log(`URL: ${result.getUrl()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return {
      success: true,
      fileId: result.getId(),
      fileName: result.getName(),
      url: result.getUrl(),
      message: `PDFの回転が完了しました (${processingTime}秒)`,
      processingTime: parseFloat(processingTime),
      details: {
        mode: mode,
        rotation: rotation,
        pagesProcessed: targetPages,
        overwrite: overwrite
      }
    };
    
  } catch (error) {
    // ==================== エラーハンドリング ====================
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ エラーが発生しました');
    console.error(`エラー内容: ${error.toString()}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return {
      success: false,
      error: error.toString(),
      message: `処理に失敗しました: ${error.message}`
    };
  }
}

/**
 * 入力値の検証
 * @private
 */
function validateInputs(fileId, mode, rotation, pages, startPage, endPage) {
  // 必須パラメータの確認
  if (!fileId) {
    throw new Error('fileId は必須です');
  }
  
  if (!mode) {
    throw new Error('mode は必須です');
  }
  
  if (!rotation) {
    throw new Error('rotation は必須です');
  }
  
  // モードの検証
  const validModes = ['single', 'multiple', 'range', 'all', 'even', 'odd'];
  if (!validModes.includes(mode)) {
    throw new Error(`mode は ${validModes.join(', ')} のいずれかである必要があります`);
  }
  
  // 回転角度の検証
  const validRotations = [90, 180, 270];
  if (!validRotations.includes(rotation)) {
    throw new Error('rotation は 90, 180, 270 のいずれかである必要があります');
  }
  
  // モード別の必須パラメータ確認
  switch (mode) {
    case 'single':
      if (!pages) {
        throw new Error('single モードでは pages (ページ番号) が必須です');
      }
      break;
      
    case 'multiple':
      if (!pages) {
        throw new Error('multiple モードでは pages (ページ番号の配列または文字列) が必須です');
      }
      break;
      
    case 'range':
      if (!startPage || !endPage) {
        throw new Error('range モードでは startPage と endPage が必須です');
      }
      if (startPage > endPage) {
        throw new Error('startPage は endPage 以下である必要があります');
      }
      break;
  }
}

/**
 * ============================================
 * シンプルな実行用関数（モード別）
 * より直感的に使用できる個別関数
 * ============================================
 */

/**
 * 1ページだけ回転
 */
async function rotateSinglePage(fileId, pageNumber, rotation, overwrite, outputName) {
  return await rotatePDF(fileId, 'single', rotation, pageNumber, null, null, overwrite, outputName);
}

/**
 * 複数ページを回転
 */
async function rotateMultiplePages(fileId, pageNumbers, rotation, overwrite, outputName) {
  return await rotatePDF(fileId, 'multiple', rotation, pageNumbers, null, null, overwrite, outputName);
}

/**
 * ページ範囲を回転
 */
async function rotatePageRange(fileId, startPage, endPage, rotation, overwrite, outputName) {
  return await rotatePDF(fileId, 'range', rotation, null, startPage, endPage, overwrite, outputName);
}

/**
 * 全ページ回転
 */
async function rotateAll(fileId, rotation, overwrite, outputName) {
  return await rotatePDF(fileId, 'all', rotation, null, null, null, overwrite, outputName);
}

/**
 * 偶数ページ回転
 */
async function rotateEven(fileId, rotation, overwrite, outputName) {
  return await rotatePDF(fileId, 'even', rotation, null, null, null, overwrite, outputName);
}

/**
 * 奇数ページ回転
 */
async function rotateOdd(fileId, rotation, overwrite, outputName) {
  return await rotatePDF(fileId, 'odd', rotation, null, null, null, overwrite, outputName);
}

/**
 * ============================================
 * 使用例: 様々なパターンでの実行
 * ============================================
 */

// 使用例1: メイン関数で1ページ目を90度回転
async function example1_main() {
  const result = await rotatePDF(
    'YOUR_FILE_ID',  // fileId
    'single',         // mode
    90,              // rotation
    1,               // pages
    null,            // startPage (不要)
    null,            // endPage (不要)
    false,           // overwrite
    'rotated.pdf'    // outputName
  );
  console.log(result);
}

// 使用例2: シンプル関数で1ページ目を90度回転
async function example2_simple() {
  const result = await rotateSinglePage(
    'YOUR_FILE_ID',  // fileId
    1,               // pageNumber
    90,              // rotation
    false,           // overwrite
    'rotated.pdf'    // outputName
  );
  console.log(result);
}

// 使用例3: 複数ページを180度回転（文字列指定）
async function example3_multipleString() {
  const result = await rotatePDF(
    'YOUR_FILE_ID',
    'multiple',
    180,
    '1,3,5,7',      // カンマ区切り文字列でもOK
    null,
    null,
    false,
    'multi_rotated.pdf'
  );
  console.log(result);
}

// 使用例4: 複数ページを180度回転（配列指定）
async function example4_multipleArray() {
  const result = await rotateMultiplePages(
    'YOUR_FILE_ID',
    [1, 3, 5, 7],    // 配列で指定
    180,
    false,
    'multi_rotated.pdf'
  );
  console.log(result);
}

// 使用例5: 2〜5ページを270度回転
async function example5_range() {
  const result = await rotatePageRange(
    'YOUR_FILE_ID',
    2,               // startPage
    5,               // endPage
    270,             // rotation
    true,            // overwrite
    null             // outputName (上書きなので不要)
  );
  console.log(result);
}

// 使用例6: 全ページを90度回転
async function example6_all() {
  const result = await rotateAll(
    'YOUR_FILE_ID',
    90,
    false,
    'all_rotated.pdf'
  );
  console.log(result);
}

/**
 * ============================================
 * テスト実行用
 * ============================================
 */

// テスト: 最小限のパラメータで実行
async function testMinimalParams() {
  // 必須パラメータのみ指定（その他はnullまたはundefined）
  const result = await rotatePDF(
    'YOUR_FILE_ID',
    'single',
    90,
    1
    // startPage, endPage, overwrite, outputName は省略
  );
  console.log(result);
}

// テスト: すべてのパラメータを指定
async function testAllParams() {
  const result = await rotatePDF(
    'YOUR_FILE_ID',
    'range',
    180,
    null,            // pages (rangeモードなので不要)
    2,               // startPage
    4,               // endPage
    false,           // overwrite
    'custom_name.pdf' // outputName
  );
  console.log(result);
}