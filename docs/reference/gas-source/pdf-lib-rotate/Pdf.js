// ============================================
// 2. Pdf.gs - ヘルパー関数
// ============================================
// Apps ScriptにはsetTimeoutがないので作っておく
function setTimeout(func, delayMillis) {
  func();
}

/**
 * PDFDocumentを生成する。PDFLib.PDFDocument.create()の代わりに使う
 * @returns {PDFLib.PDFDocument} PDFDocument
 */
async function createPdfDocument() {
  return await PDFLib.PDFDocument.create();
}

async function getBlob_(pdfDoc) {
  const base64String = await pdfDoc.saveAsBase64();
  const data = Utilities.base64Decode(base64String);
  return Utilities.newBlob(data).setContentType(MimeType.PDF);
}

/**
 * PDFDocumentをGoogleドライブに保存する
 * @param {PDFLib.PDFDocument} pdfDoc PDFDocument
 * @param {String} filename オプション。ファイル名。デフォルトは unnamed.pdf
 * @param {String} folderId オプション。保存先のフォルダーID
 * @returns {DriveApp.File} DriveApp.File
 */
async function savePdfDocument(pdfDoc, filename = 'unnamed.pdf', folderId) {
  const blob = await getBlob_(pdfDoc);
  if (filename) blob.setName(filename);
  if (folderId) {
    return DriveApp.getFolderById(folderId).createFile(blob);
  }
  return DriveApp.createFile(blob);
}

/**
 * PDFDocumentをGoogleドライブから読み込む
 * @param {String} fileId GoogleドライブのファイルID
 * @returns {PDFLib.PDFDocument} PDFLib.PDFDocument
 */
async function loadPdfDocument(fileId) {
  const blob = DriveApp.getFileById(fileId).getBlob();
  const bytes = blob.getBytes();
  const base64String = Utilities.base64Encode(bytes);
  return await PDFLib.PDFDocument.load(base64String);
}

/**
 * PDFDocumentを安全に上書き保存する
 * 新しいファイルを作成し、古いファイルをゴミ箱へ移動
 * 
 * @param {String} fileId 元のファイルID
 * @param {PDFLib.PDFDocument} pdfDoc 保存するPDFDocument
 * @returns {DriveApp.File} 新しいファイルオブジェクト（新しいID・URLを持つ）
 */
async function updatePdfDocument(fileId, pdfDoc) {
  // PDFDocumentをBlobに変換
  const blob = await getBlob_(pdfDoc);
  
  // 元のファイル情報を取得
  const originalFile = DriveApp.getFileById(fileId);
  const fileName = originalFile.getName();
  const parents = originalFile.getParents();
  const folder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  
  // Blobに名前を設定（重要！）
  blob.setName(fileName);
  
  // 新しいファイルを作成（安全）
  const newFile = folder.createFile(blob);
  
  // 古いファイルをゴミ箱へ
  originalFile.setTrashed(true);
  
  console.log('PDFファイルを上書き保存しました');
  return newFile;
}