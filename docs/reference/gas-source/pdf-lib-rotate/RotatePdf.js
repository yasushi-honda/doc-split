// ============================================
// 3. RotatePdf.gs - PDF回転機能のメインコード
// ============================================

/**
 * PDFの特定ページを回転させる
 * @param {String} fileId - 対象PDFファイルのGoogle Drive ID
 * @param {Number|Array} targetPages - 回転させるページ番号（1始まり）。単一の数値または配列
 * @param {Number} rotationDegrees - 回転角度（90, 180, 270など）
 * @param {Boolean} overwrite - 元のファイルを上書きするか（false の場合は新規ファイルを作成）
 * @returns {DriveApp.File} 処理後のファイル
 */
async function rotatePdfPages(fileId, targetPages, rotationDegrees, overwrite = false) {
  try {
    // PDFを読み込み
    console.log('PDFファイルを読み込み中...');
    const pdfDoc = await loadPdfDocument(fileId);
    
    // ページ配列を取得
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    console.log(`総ページ数: ${totalPages}`);
    
    // targetPagesを配列に統一
    const pageNumbers = Array.isArray(targetPages) ? targetPages : [targetPages];
    
    // ページ番号の検証
    for (const pageNum of pageNumbers) {
      if (pageNum < 1 || pageNum > totalPages) {
        throw new Error(`ページ番号 ${pageNum} は範囲外です（1〜${totalPages}の間で指定してください）`);
      }
    }
    
    // 指定されたページを回転
    for (const pageNum of pageNumbers) {
      const pageIndex = pageNum - 1; // 0ベースのインデックスに変換
      const page = pages[pageIndex];
      
      // 現在の回転角度を取得
      const currentRotation = page.getRotation().angle;
      
      // 新しい回転角度を設定（現在の角度に加算）
      const newRotation = (currentRotation + rotationDegrees) % 360;
      page.setRotation(PDFLib.degrees(newRotation));
      
      console.log(`ページ ${pageNum}: ${currentRotation}° → ${newRotation}°`);
    }
    
    // ファイルを保存
    let result;
    if (overwrite) {
      // 元のファイルを上書き
      result = await updatePdfDocument(fileId, pdfDoc);
      console.log('PDFファイルを上書き保存しました');
    } else {
      // 新しいファイルとして保存
      const originalFile = DriveApp.getFileById(fileId);
      const originalName = originalFile.getName();
      const newName = originalName.replace('.pdf', '_rotated.pdf');
      result = await savePdfDocument(pdfDoc, newName);
      console.log(`新しいPDFファイルを作成しました: ${newName}`);
    }
    
    return result;
    
  } catch (error) {
    console.error('エラーが発生しました:', error.toString());
    throw error;
  }
}

/**
 * 使用例1: 単一ページを回転
 */
async function example_rotateSinglePage() {
  const fileId = 'YOUR_PDF_FILE_ID'; // ここにPDFファイルのIDを入力
  const pageNumber = 1; // 1ページ目
  const rotation = 90; // 90度回転
  const overwrite = false; // 新しいファイルとして保存
  
  const result = await rotatePdfPages(fileId, pageNumber, rotation, overwrite);
  console.log(`処理完了: ${result.getUrl()}`);
}

/**
 * 使用例2: 複数ページを回転
 */
async function example_rotateMultiplePages() {
  const fileId = 'YOUR_PDF_FILE_ID'; // ここにPDFファイルのIDを入力
  const pageNumbers = [1, 3, 5]; // 1, 3, 5ページ目
  const rotation = 180; // 180度回転
  const overwrite = true; // 元のファイルを上書き
  
  const result = await rotatePdfPages(fileId, pageNumbers, rotation, overwrite);
  console.log(`処理完了: ${result.getUrl()}`);
}

/**
 * 使用例3: 範囲指定で回転（ヘルパー関数）
 */
async function rotatePdfPagesInRange(fileId, startPage, endPage, rotationDegrees, overwrite = false) {
  // 指定範囲のページ番号配列を作成
  const pageNumbers = [];
  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }
  
  return await rotatePdfPages(fileId, pageNumbers, rotationDegrees, overwrite);
}

/**
 * 使用例4: ページ範囲を指定して回転
 */
async function example_rotatePageRange() {
  const fileId = 'YOUR_PDF_FILE_ID';
  const startPage = 2;
  const endPage = 4; // 2〜4ページを回転
  const rotation = 270; // 270度（-90度）回転
  const overwrite = false;
  
  const result = await rotatePdfPagesInRange(fileId, startPage, endPage, rotation, overwrite);
  console.log(`処理完了: ${result.getUrl()}`);
}

/**
 * 使用例5: すべてのページを回転
 */
async function rotateAllPages(fileId, rotationDegrees, overwrite = false) {
  // PDFを読み込んで総ページ数を取得
  const pdfDoc = await loadPdfDocument(fileId);
  const totalPages = pdfDoc.getPages().length;
  
  // すべてのページ番号の配列を作成
  const allPages = Array.from({ length: totalPages }, (_, i) => i + 1);
  
  return await rotatePdfPages(fileId, allPages, rotationDegrees, overwrite);
}

/**
 * 使用例6: 偶数ページのみ回転
 */
async function rotateEvenPages(fileId, rotationDegrees, overwrite = false) {
  const pdfDoc = await loadPdfDocument(fileId);
  const totalPages = pdfDoc.getPages().length;
  
  // 偶数ページの配列を作成
  const evenPages = [];
  for (let i = 2; i <= totalPages; i += 2) {
    evenPages.push(i);
  }
  
  return await rotatePdfPages(fileId, evenPages, rotationDegrees, overwrite);
}

/**
 * 使用例7: 奇数ページのみ回転
 */
async function rotateOddPages(fileId, rotationDegrees, overwrite = false) {
  const pdfDoc = await loadPdfDocument(fileId);
  const totalPages = pdfDoc.getPages().length;
  
  // 奇数ページの配列を作成
  const oddPages = [];
  for (let i = 1; i <= totalPages; i += 2) {
    oddPages.push(i);
  }
  
  return await rotatePdfPages(fileId, oddPages, rotationDegrees, overwrite);
}

/**
 * テスト用: サンプルPDFを作成して回転テスト
 */
async function testRotation() {
  // テスト用PDFを作成
  const pdfDoc = await createPdfDocument();
  
  // 3ページ追加（異なる向きでテキストを配置）
  for (let i = 1; i <= 3; i++) {
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    page.drawText(`Page ${i}`, {
      x: 50,
      y: height / 2,
      size: 30,
    });
    
    page.drawText(`Width: ${width}, Height: ${height}`, {
      x: 50,
      y: height / 2 - 40,
      size: 12,
    });
    
    // ページ番号に応じて線を引く
    page.drawLine({
      start: { x: 50, y: height / 2 - 60 },
      end: { x: width - 50, y: height / 2 - 60 },
      thickness: 2,
    });
  }
  
  // テストPDFを保存
  const testFile = await savePdfDocument(pdfDoc, 'test_rotation.pdf');
  console.log(`テストPDFを作成: ${testFile.getUrl()}`);
  
  // 2ページ目を90度回転
  const rotatedFile = await rotatePdfPages(testFile.getId(), 2, 90, false);
  console.log(`回転後のPDF: ${rotatedFile.getUrl()}`);
}
