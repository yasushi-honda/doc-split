// index.js - 完全修正版: Base64エンコード対応 + 共有ドライブ対応 + エラーハンドリング強化
const functionsFramework = require('@google-cloud/functions-framework');
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');

// デフォルトモデル - 手書きOCR用に2.0を推奨
const DEFAULT_MODEL = 'gemini-2.0-flash-001';

// 一時ファイル用ディレクトリ
const TEMP_DIR = path.join(os.tmpdir(), 'ocr-processing');

// ★修正: Vertex AI のベース URL（正しいエンドポイント）
const getVertexBaseUrl = (projectId, region = 'us-central1') => 
  `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models`;

// モデルに応じた設定を取得
const getModelConfig = (model) => {
  const configs = {
    'gemini-2.0-flash-001': {
      maxOutputTokens: 8192,
      temperature: 0.1
    },
    'gemini-1.5-flash': {
      maxOutputTokens: 8192,
      temperature: 0.1
    },
    'gemini-1.5-pro': {
      maxOutputTokens: 32768,
      temperature: 0.1
    }
  };
  return configs[model] || configs[DEFAULT_MODEL];
};

// 一時ディレクトリ作成
const ensureTempDir = () => {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
};

// 一時ファイル削除
const cleanupTempFiles = (filePaths) => {
  filePaths.forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted temp file: ${filePath}`);
      }
    } catch (error) {
      console.error(`⚠️ Failed to delete temp file ${filePath}:`, error.message);
    }
  });
};

// ★修正: Google Drive からファイルを取得（Base64対応強化版）
async function downloadFileFromDrive(fileId, auth) {
  const drive = google.drive({ version: 'v3', auth });
  
  try {
    // ファイルメタデータを取得
    const metadata = await drive.files.get({
      fileId: fileId,  
      fields: 'name,mimeType,size',
      supportsAllDrives: true
    });
    
    console.log('📁 File metadata:', {
      name: metadata.data.name,
      mimeType: metadata.data.mimeType,
      size: metadata.data.size
    });

    // ★改善: ファイルサイズチェック（100MB制限）
    const fileSizeBytes = parseInt(metadata.data.size) || 0;
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB
    
    if (fileSizeBytes > maxSizeBytes) {
      throw new Error(`File too large: ${Math.round(fileSizeBytes / 1024 / 1024)}MB exceeds 100MB limit`);
    }

    // ファイル内容を取得
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media',
      supportsAllDrives: true
    }, {
      responseType: 'arraybuffer'  // ★重要: arraybufferで取得
    });    

    // ★修正: ArrayBufferを確実にBufferに変換
    let buffer;
    if (response.data instanceof ArrayBuffer) {
      buffer = Buffer.from(response.data);
      console.log(`📥 Converted ArrayBuffer to Buffer: ${buffer.length} bytes`);
    } else if (Buffer.isBuffer(response.data)) {
      buffer = response.data;
      console.log(`📥 Already Buffer: ${buffer.length} bytes`);
    } else {
      // その他の形式の場合
      buffer = Buffer.from(response.data);
      console.log(`📥 Converted unknown format to Buffer: ${buffer.length} bytes`);
    }

    return {
      buffer: buffer,  // ★確実にBufferオブジェクト
      mimeType: metadata.data.mimeType,
      fileName: metadata.data.name,
      fileSize: metadata.data.size
    };
  } catch (error) {
    throw new Error(`Google Drive API error: ${error.message}`);
  }
}

// PDFを個別ページに分割
async function splitPdfToPages(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const splitFiles = [];
  
  console.log(`📄 Splitting PDF into ${totalPages} pages`);
  
  // ★改善: ページ数制限チェック
  if (totalPages > 200) {
    console.warn(`⚠️ Large PDF detected: ${totalPages} pages`);
  }
  
  for (let i = 0; i < totalPages; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);
    
    const pdfBytes = await newPdf.save();
    const tempFilePath = path.join(TEMP_DIR, `page_${i + 1}.pdf`);
    
    fs.writeFileSync(tempFilePath, pdfBytes);
    
    splitFiles.push({
      filePath: tempFilePath,
      pageNumber: i + 1,
      buffer: Buffer.from(pdfBytes),  // ★確実にBufferオブジェクト
      mimeType: 'application/pdf'
    });
  }
  
  return splitFiles;
}

// 画像ファイルの場合（分割せずそのまま処理）
function processSingleImage(imageBuffer, mimeType) {
  const tempFilePath = path.join(TEMP_DIR, `image_1.${mimeType.split('/')[1]}`);
  fs.writeFileSync(tempFilePath, imageBuffer);
  
  return [{
    filePath: tempFilePath,
    pageNumber: 1,
    buffer: Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer),  // ★確実にBufferオブジェクト
    mimeType: mimeType
  }];
}

// ★修正: OCR処理のメイン関数（Base64エンコード完全対応版）
async function processOCR(fileBuffer, mimeType, model, auth, projectId, pageNumber = 1) {
  const config = getModelConfig(model);
  
  // ★修正: 確実にBase64エンコード
  let fileBase64;
  try {
    if (Buffer.isBuffer(fileBuffer)) {
      // BufferオブジェクトからBase64に変換
      fileBase64 = fileBuffer.toString('base64');
      console.log(`🔧 Buffer to Base64: ${fileBase64.length} chars for page ${pageNumber}`);
    } else if (Array.isArray(fileBuffer)) {
      // 配列の場合、Bufferに変換してからBase64に
      fileBase64 = Buffer.from(fileBuffer).toString('base64');
      console.log(`🔧 Array to Base64: ${fileBase64.length} chars for page ${pageNumber}`);
    } else if (typeof fileBuffer === 'string') {
      // 既にBase64文字列の場合
      fileBase64 = fileBuffer;
      console.log(`🔧 String Base64: ${fileBase64.length} chars for page ${pageNumber}`);
    } else if (fileBuffer instanceof Uint8Array) {
      // Uint8Arrayの場合
      fileBase64 = Buffer.from(fileBuffer).toString('base64');
      console.log(`🔧 Uint8Array to Base64: ${fileBase64.length} chars for page ${pageNumber}`);
    } else {
      // その他の場合、強制的にBufferに変換
      fileBase64 = Buffer.from(fileBuffer).toString('base64');
      console.log(`🔧 Other to Base64: ${fileBase64.length} chars for page ${pageNumber}`);
    }
    
    // Base64の妥当性チェック
    if (!fileBase64 || fileBase64.length === 0) {
      throw new Error('Base64 encoding resulted in empty string');
    }
    
    // Base64形式の簡単な検証（英数字+/+=のみであることを確認）
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(fileBase64)) {
      console.warn(`⚠️ Potentially invalid Base64 format for page ${pageNumber}, but proceeding...`);
    }
    
  } catch (error) {
    console.error(`❌ Base64 encoding failed for page ${pageNumber}:`, error.message);
    throw new Error(`Base64 encoding error: ${error.message}`);
  }
  
  console.log(`🔧 Processing page ${pageNumber} with model: ${model}, Base64 length: ${fileBase64.length}`);

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: fileBase64  // ★確実にBase64文字列
            }
          },
          {
            text: `この画像またはPDF内の全てのテキストを抽出してください。正確に文字を読み取り、レイアウトを保持して出力してください。手書き文字も含めて認識してください。これはページ${pageNumber}の内容です。`
          }
        ]
      }
    ],
    safety_settings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
    ],
    generation_config: {
      temperature: config.temperature,
      max_output_tokens: config.maxOutputTokens,
    }
  };

  // ★修正: 認証とエンドポイント設定
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  
  // 正しいエンドポイント生成
  const baseUrl = getVertexBaseUrl(projectId);
  const endpoint = `${baseUrl}/${model}:generateContent`;
  
  console.log(`🌐 API Endpoint: ${endpoint}`);

  const apiRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const status = apiRes.status;
  const responseText = await apiRes.text();

  if (status !== 200) {
    console.error(`❌ API Error ${status}:`, responseText);
    throw new Error(`Vertex AI API error (${status}): ${responseText}`);
  }

  const json = JSON.parse(responseText);
  
  const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason = json.candidates?.[0]?.finishReason;

  return {
    text: candidateText,
    finishReason: finishReason,
    usageMetadata: json.usageMetadata,
    pageNumber: pageNumber,
    fullResponse: json
  };
}

// 単一ページのOCR処理（強化版）
async function processPageOCR(pageData, model, auth, projectId) {
  const usedModel = model || DEFAULT_MODEL;
  
  try {
    const startTime = Date.now();
    const result = await processOCR(pageData.buffer, pageData.mimeType, usedModel, auth, projectId, pageData.pageNumber);
    const processingTime = Date.now() - startTime;
    
    // 基本的なエラーチェック
    if (result.finishReason === 'MAX_TOKENS') {
      throw new Error('MAX_TOKENS_ERROR - Content too large for processing');
    }

    if (!result.text || result.text.trim().length === 0) {
      throw new Error('NO_TEXT_ERROR - No text extracted from page');
    }

    console.log(`✅ Page ${pageData.pageNumber}: ${result.text.length} chars in ${processingTime}ms`);

    return {
      pageNumber: pageData.pageNumber,
      text: result.text,
      model: usedModel,
      usageMetadata: result.usageMetadata,
      finishReason: result.finishReason,
      processingTimeMs: processingTime
    };

  } catch (error) {
    console.error(`❌ Page ${pageData.pageNumber} processing failed:`, error.message);
    throw error;
  }
}

// ★改善: パラレル処理制限付きのページ処理
async function processAllPages(splitFiles, requestedModel, auth, projectId) {
  const BATCH_SIZE = 3; // 並列処理数を制限
  const ocrResults = [];
  const errors = [];
  
  // バッチ処理でページを並列実行
  for (let i = 0; i < splitFiles.length; i += BATCH_SIZE) {
    const batch = splitFiles.slice(i, i + BATCH_SIZE);
    console.log(`🔄 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(splitFiles.length/BATCH_SIZE)}: pages ${batch.map(p => p.pageNumber).join(', ')}`);
    
    const batchPromises = batch.map(async (pageData) => {
      try {
        const result = await processPageOCR(pageData, requestedModel, auth, projectId);
        return { success: true, result };
      } catch (error) {
        return { 
          success: false, 
          error: {
            pageNumber: pageData.pageNumber,
            error: error.message
          }
        };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(batchResult => {
      if (batchResult.success) {
        ocrResults.push(batchResult.result);
      } else {
        errors.push(batchResult.error);
      }
    });
    
    // バッチ間で少し待機（レート制限対策）
    if (i + BATCH_SIZE < splitFiles.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return { ocrResults, errors };
}

// ★メイン処理: Cloud Function エントリーポイント
functionsFramework.http('ocrGeminiNew', async (req, res) => {
  const startTime = Date.now();
  console.log('🚀 OCR request received:', { 
    fileId: req.body?.fileId,
    requestedModel: req.body?.model,
    timestamp: new Date().toISOString()
  });

  const { fileId, model: requestedModel } = req.body || {};

  if (!fileId) {
    console.error('❌ Missing parameter: fileId must be provided');
    return res.status(400).json({
      success: false,
      error: 'fileId を指定してください'
    });
  }

  const tempFiles = [];
  
  try {
    // 一時ディレクトリの準備
    ensureTempDir();

    // Google Drive API 用の認証設定
    const auth = new GoogleAuth({
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/drive.readonly'
      ]
    });
    const projectId = await auth.getProjectId();
    console.log('🔍 Authenticated Project ID:', projectId);

    // Google Drive からファイルをダウンロード
    console.log(`📥 Downloading file from Google Drive: ${fileId}`);
    const fileData = await downloadFileFromDrive(fileId, await auth.getClient());
    
    // ファイル形式に応じて分割処理
    let splitFiles = [];
    
    if (fileData.mimeType === 'application/pdf') {
      splitFiles = await splitPdfToPages(fileData.buffer);
    } else if (fileData.mimeType.startsWith('image/')) {
      splitFiles = processSingleImage(fileData.buffer, fileData.mimeType);
    } else {
      throw new Error(`Unsupported file type: ${fileData.mimeType}`);
    }

    tempFiles.push(...splitFiles.map(f => f.filePath));
    console.log(`📋 Split into ${splitFiles.length} page(s)`);

    // ★改善: バッチ処理でOCR実行
    const { ocrResults, errors } = await processAllPages(splitFiles, requestedModel, auth, projectId);

    // 結果をページ番号順にソート
    ocrResults.sort((a, b) => a.pageNumber - b.pageNumber);

    // 使用統計を計算
    const totalUsage = ocrResults.reduce((acc, result) => {
      if (result.usageMetadata) {
        acc.promptTokens += result.usageMetadata.promptTokenCount || 0;
        acc.outputTokens += result.usageMetadata.candidatesTokenCount || 0;
        acc.totalTokens += result.usageMetadata.totalTokenCount || 0;
      }
      return acc;
    }, { promptTokens: 0, outputTokens: 0, totalTokens: 0 });

    const totalTime = Date.now() - startTime;
    console.log(`✅ OCR completed: ${ocrResults.length}/${splitFiles.length} pages in ${totalTime}ms`);
    console.log(`📊 Total token usage:`, totalUsage);

    // ★改善: GAS側の期待する形式に完全準拠
    res.status(200).json({
      success: true,
      fileInfo: {
        fileId: fileId,
        fileName: fileData.fileName,
        mimeType: fileData.mimeType,
        totalPages: splitFiles.length
      },
      ocrResults: ocrResults,
      errors: errors.length > 0 ? errors : undefined,
      processingInfo: {
        totalPages: splitFiles.length,
        successfulPages: ocrResults.length,
        failedPages: errors.length,
        totalUsage: totalUsage,
        totalProcessingTimeMs: totalTime
      }
    });

  } catch (err) {
    console.error('💥 Error in OCR processing:', err);
    res.status(500).json({
      success: false,
      error: 'OCR processing failed',
      details: err.message
    });
  } finally {
    // 一時ファイルのクリーンアップ
    if (tempFiles.length > 0) {
      console.log(`🧹 Cleaning up ${tempFiles.length} temporary files...`);
      cleanupTempFiles(tempFiles);
    }
  }
});
