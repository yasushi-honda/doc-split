---
title: "書類管理 App 仕様書"
description: "AppSheetで構築された書類管理アプリケーションの完全仕様書。30テーブル、593カラム、26ビュー、30アクションを含む。OCR処理による書類の自動分類・顧客紐付け機能を提供。"
source_file: "Application Documentation.pdf"
converted_at: "2026-01-17T01:11:53.739124"
page_count: 474
sections:
  - Data (テーブル・カラム定義)
  - UX (ビュー定義)
  - Behavior (アクション・ワークフロー)
tags:
  - appsheet
  - 書類管理
  - ocr
  - specification
  - ai-context
status: ready
---

2026/01/17 0:58 Application Documentation

# 書類管理 App-890309208 Documentation


Generated at:

2026/1/17 0:57:34

# App



Data Summary



30 Tables

593 Columns

0 Slices



26 Views
UX Summary
3 Format Rules


30 Actions
Behavior Summary
0 Workflow Rules


Short Name 書類管理 App


Version 1.000237


Default app folder /appsheet/data/ 書類管理 App-890309208


Runnable? Yes


Deployable? No


Personal use only? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 1/474


2026/01/17 0:58 Application Documentation

## Data

### Tables

#### Table name _Per User Settings


Table name _Per User Settings


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? No


Data locale en-US


Schema _Per User Settings_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path _Per User Settings


Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 書類管理 T


Table name 書類管理 T


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 書類管理 T_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path 書類管理 T


Worksheet Name/Qualifier 書類管理 T


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 2/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name 書類 M


Table name 書類 M


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 書類 M_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path 書類 M


Worksheet Name/Qualifier 書類 M


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 事業所 M


Table name 事業所 M


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 事業所 M_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path 事業所 M


Worksheet Name/Qualifier 事業所 M


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 3/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name 顧客 M


Table name 顧客 M


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 顧客 M_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path 顧客 M


Worksheet Name/Qualifier 顧客 M


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name Gmail 受信管理 T


Table name Gmail 受信管理 T


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema Gmail 受信管理 T_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path Gmail 受信管理 T


Worksheet Name/Qualifier Gmail 受信管理 T


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 4/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name エラー履歴 T


Table name エラー履歴 T


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema エラー履歴 T_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path エラー履歴 T


Worksheet Name/Qualifier エラー履歴 T


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 保守 T


Table name 保守 T


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 保守 T_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path 保守 T


Worksheet Name/Qualifier 保守 T


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 5/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name ケアマネ M


Table name ケアマネ M


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema ケアマネ M_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path ケアマネ M


Worksheet Name/Qualifier ケアマネ M


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 担当 CMT


Table name 担当 CMT


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 担当 CMT_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path ケアマネ M


Worksheet Name/Qualifier 担当 CMT


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 6/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name 利用者情報


Table name 利用者情報


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Data locale ja-JP


Schema 利用者情報 _Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Source Path 利用者情報 _ 外字変換 tool


Worksheet Name/Qualifier 利用者情報


Data Source google


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name Process for 書類情報の更新によるファイルリネーム - 1 Process Table


Process for 書類情報の更新によるファイルリネーム                   - 1
Table name
Process Table


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Process for 書類情報の更新によるファイルリネーム                   - 1
Schema
Process Table_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0e345ae8-a411-4439-bf9d-6c5b38937fbf/State

Table



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 7/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name ファイルリネーム Output


Table name ファイルリネーム Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema ファイルリネーム Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0e345ae8-a411-4439-bf9d
6c5b38937fbf/StepOutput_ ファイルリネーム



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 新しいファイル名を上書き Output


Table name 新しいファイル名を上書き Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema 新しいファイル名を上書き Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0e345ae8-a411-4439-bf9d
6c5b38937fbf/StepOutput_ 新しいファイル名を上書き



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 8/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name リネーム false Output


Table name リネーム false Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema リネーム false Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0e345ae8-a411-4439-bf9d
6c5b38937fbf/StepOutput_ リネーム false



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name Process for ファイルアップロード - 1 Process Table


Table name Process for ファイルアップロード  - 1 Process Table


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema Process for ファイルアップロード - 1 Process Table_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/dabc488b-f1e0-4ac3-acaf
a9466a1ba594/State Table



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 9/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name ファイルアップロード時処理 Output


Table name ファイルアップロード時処理 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema ファイルアップロード時処理 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/dabc488b-f1e0-4ac3-acaf
a9466a1ba594/StepOutput_ ファイルアップロード時処理



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name URL やファイル名の入力 Output


Table name URL やファイル名の入力 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema URL やファイル名の入力 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/dabc488b-f1e0-4ac3-acaf
a9466a1ba594/StepOutput_URL やファイル名の入力



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 10/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name Process for OCR 再読み込み準備 - 1 Process Table


Table name Process for OCR 再読み込み準備    - 1 Process Table


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema Process for OCR 再読み込み準備    - 1 Process Table_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0a948ba7-0e93-4e88-8737
936c2d7c65ff/State Table



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 【 GAS 】「 OCR 対象書類」フォルダーに移動 Output


Table name 【 GAS 】「 OCR 対象書類」フォルダーに移動 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema 【 GAS 】「 OCR 対象書類」フォルダーに移動 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0a948ba7-0e93-4e88-8737
936c2d7c65ff/StepOutput_ 【 GAS 】「 OCR 対象書類」フォルダ



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 11/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name 当レコードを削除 Output


Table name 当レコードを削除 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema 当レコードを削除 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/0a948ba7-0e93-4e88-8737
936c2d7c65ff/StepOutput_ 当レコードを削除



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name Process for 別ページ情報追加 Process Table


Table name Process for 別ページ情報追加 Process Table


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema Process for 別ページ情報追加 Process Table_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/38fbe095-ee9b-46b2-8cfa
adbb162670aa/State Table



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 12/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name File タイプなど強制入力 Output


Table name File タイプなど強制入力 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema File タイプなど強制入力 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/38fbe095-ee9b-46b2-8cfa
adbb162670aa/StepOutput_File タイプなど強制入力



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 別ページ情報追加クリア Output


Table name 別ページ情報追加クリア Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema 別ページ情報追加クリア Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/38fbe095-ee9b-46b2-8cfa
adbb162670aa/StepOutput_ 別ページ情報追加クリア



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 13/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name Process for PDF 向き変更 - 1 Process Table


Table name Process for PDF 向き変更    - 1 Process Table


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema Process for PDF 向き変更    - 1 Process Table_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/fa9f88f9-1539-4945-b87d-22bbcecde94b/State

Table



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name 【 GAS 】回転処理 Output


Table name 【 GAS 】回転処理 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema 【 GAS 】回転処理 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/fa9f88f9-1539-4945-b87d
22bbcecde94b/StepOutput_ 【 GAS 】回転処理



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 14/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
worksheets?

#### Table name ファイル情報の更新と向き設定の初期化 Output


Table name ファイル情報の更新と向き設定の初期化 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema ファイル情報の更新と向き設定の初期化 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/fa9f88f9-1539-4945-b87d
22bbcecde94b/StepOutput_ ファイル情報の更新と向き設定の

初期化



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name Process for メールの添付ファイルから再取得（ GAS ） - 1 Process Table


Process for メールの添付ファイルから再取得（ GAS ）               - 1
Table name
Process Table


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Process for メールの添付ファイルから再取得（ GAS ）               - 1
Schema
Process Table_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/d2f56e7a-cf85-4583-8573-3bf3ca25a78b/State

Table



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 15/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name メールの添付ファイルから再取得（ GAS ） Output


Table name メールの添付ファイルから再取得（ GAS ） Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema メールの添付ファイルから再取得（ GAS ） Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/d2f56e7a-cf85-4583-8573
3bf3ca25a78b/StepOutput_ メールの添付ファイルから再取得
（ GAS ）



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

#### Table name ステータス完了 Output


Table name ステータス完了 Output


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Shared? Yes


Schema ステータス完了 Output_Schema


Are updates allowed? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



Source Path



/ProcessStateTables/7d1e0929-85d7-4683-8e7c
239e80477a5d/d2f56e7a-cf85-4583-8573
3bf3ca25a78b/StepOutput_ ステータス完了



Data Source native


Store for image and file
_Default
capture


Column Order List _RowNumber


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 16/474


2026/01/17 0:58 Application Documentation


Partitioned across many
No
files/sources?


Partitioned across many
No
worksheets?

### Columns

#### Schema Name _Per User Settings_Schema


Schema Name _Per User Settings_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 17/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 2: _EMAIL


Column name _EMAIL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Email



Type Qualifier



{"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



App formula USEREMAIL()


Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 3: _NAME


Column name _NAME


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Name



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



App formula USERNAME()


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 18/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 4: _LOCATION


Column name _LOCATION


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LatLong



Type Qualifier



{"RealTime":false,"PublishIfRowKey":null,"KMLFileUrl":null,"Valid_

If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Required_If

":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 19/474


2026/01/17 0:58 Application Documentation


Searchable No


Scannable No


Sensitive data No

## Column 5: Options Heading


Column name Options Heading


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Show



Type Qualifier



{"Category":"Text","Content":"\"These options control the

content and behavior of the

app\"","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":nul

l,"Required_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Va

lues":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 6: Option 1


Column name Option 1


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 20/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 7: Option 2


Column name Option 2


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 21/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 8: Country Option


Column name Country Option


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["Australia","Brazil","Canada"],"AllowOtherValues":false,"AutoCom
pleteOtherValues":true,"BaseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 22/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 9: Language Option


Column name Language Option


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["English","French","Tamil"],"AllowOtherValues":false,"AutoComple
teOtherValues":true,"BaseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 10: Option 5


Column name Option 5


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 23/474


2026/01/17 0:58 Application Documentation


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 11: Option 6


Column name Option 6


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 24/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 12: Option 7


Column name Option 7


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 13: Option 8


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 25/474


2026/01/17 0:58 Application Documentation


Column name Option 8


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 14: Option 9


Column name Option 9


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 26/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No

## Column 15: _THISUSER


Column name _THISUSER


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value onlyvalue


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName en-US


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 27/474


2026/01/17 0:58 Application Documentation

#### Schema Name 書類管理 T_Schema


Schema Name 書類管理 T_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 28/474


2026/01/17 0:58 Application Documentation


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value UNIQUEID()


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value =NOW()


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 29/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 30/474


2026/01/17 0:58 Application Documentation
## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 31/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 32/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 33/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 34/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


=IF(CONTEXT("View") = " 書類管理 T_Form", " ファイル ", " ファイ
Display name
ル URL")


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 35/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 36/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 37/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 38/474


2026/01/17 0:58 Application Documentation


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 39/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 40/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 41/474


2026/01/17 0:58 Application Documentation


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 42/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 43/474


2026/01/17 0:58 Application Documentation


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 44/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



App formula =TEXT([ ファイル URL])


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 45/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



App formula =[ 顧客名 ] = " 未登録顧客 "


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 46/474


2026/01/17 0:58 Application Documentation
## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



App formula =[ 書類名 ] = " 未判定 "


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



App formula =[ 事業所名 ] = " 未判定 "


Read-Only Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 47/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



=LOOKUP([_THISROW].[ 顧客名 ], " 担当 CMT", " 顧客氏名 ", " ケアマ
App formula
ネ名 ")


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 48/474


2026/01/17 0:58 Application Documentation


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



=LOOKUP([_THISROW].[ 書類名 ], " 書類 M", " 書類名 ", " カテゴリ
App formula ー
")


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 49/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier


App formula



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


=IF( LOOKUP([_THISROW].[ 顧客名 ], " 顧客 M", " 顧客氏名 ", " 同姓同

名 ") = TRUE, IF(ISBLANK([ （同姓同名時手動選択）顧客名 ID]), "",
（同姓同名時手動選択）顧客名 [ ID]), LOOKUP([_THISROW].[ 顧客
名 ], " 利用者情報 ", " 利用者名 ", "_ComputedKey") )



Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 50/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


App formula =[ 顧客名 ].[ 顧客氏名（フリガナ） ]


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



App formula =LEFT([ フリガナ ], 1) & "_" & [ 顧客名 ]


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 51/474


2026/01/17 0:58 Application Documentation

Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



App formula =[ 顧客名 ].[ 同姓同名 ]


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

#### Schema Name 書類 M_Schema


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 52/474


2026/01/17 0:58 Application Documentation


Schema Name 書類 M_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 53/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 日付位置


Column name 日付位置


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 54/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 55/474


2026/01/17 0:58 Application Documentation


Sensitive data No

#### Schema Name 事業所 M_Schema


Schema Name 事業所 M_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: 事業所名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 56/474


2026/01/17 0:58 Application Documentation


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 顧客 M_Schema


Schema Name 顧客 M_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 57/474


2026/01/17 0:58 Application Documentation


to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: 顧客氏名


Column name 顧客氏名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 58/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only Yes


Hidden No


Label No


Spreadsheet formula "COMPUTED_VALUE"


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: 顧客氏名（フリガナ）


Column name 顧客氏名（フリガナ）


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 59/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only Yes


Hidden No


Label No


Spreadsheet formula "COMPUTED_VALUE"


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 5: Related 書類管理 Ts


Column name Related 書類管理 Ts


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description 書類管理 T entries that reference this entry in the 顧客名 column


Type List


Type Qualifier {"ElementType":"Ref","ElementTypeQualifier":"
{\"ReferencedTableName\":\" 書類管理

T\",\"ReferencedRootTableName\":\" 書類管理
T\",\"ReferencedType\":\"Text\",\"ReferencedTypeQualifier\":\"
{\\\"MaxLength\\\":null,\\\"MinLength\\\":null,\\\"LongTextFor

matting\\\":\\\"Plain

Text\\\",\\\"IsMulticolumnKey\\\":false,\\\"Valid_If\\\":null,\\\"Er

ror_Message_If_Invalid\\\":null,\\\"Show_If\\\":null,\\\"Required

_If\\\":null,\\\"Editable_If\\\":null,\\\"Reset_If\\\":null,\\\"Sugges


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 60/474


2026/01/17 0:58 Application Documentation


ted_Values\\\":null}\",\"ReferencedKeyColumn\":\"ID\",\"IsAPart

Of\":false,\"RelationshipName\":null,\"InputMode\":\"Auto\",\"Va

lid_If\":null,\"Error_Message_If_Invalid\":null,\"Show_If\":null,\"R

equired_If\":null,\"Editable_If\":null,\"Reset_If\":null,\"Suggested

_Values\":null}","ItemSeparator":",

","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}


App formula REF_ROWS(" 書類管理 T", " 顧客名 ")


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


NFC Scannable No


Sensitive data No

#### Schema Name Gmail 受信管理 T_Schema


Schema Name Gmail 受信管理 T_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 61/474


2026/01/17 0:58 Application Documentation


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 62/474


2026/01/17 0:58 Application Documentation


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: ハッシュ値


Column name ハッシュ値


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイルサイズ (KB)


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 63/474


2026/01/17 0:58 Application Documentation


Column name ファイルサイズ (KB)


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 5: メール件名


Column name メール件名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 64/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 6: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 65/474


2026/01/17 0:58 Application Documentation
## Column 7: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 8: メール本文


Column name メール本文


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 66/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name エラー履歴 T_Schema


Schema Name エラー履歴 T_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 67/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: エラー ID


Column name エラー ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value UNIQUEID()


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: エラー発生日時


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 68/474


2026/01/17 0:58 Application Documentation


Column name エラー発生日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value NOW()


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: エラー種別


Column name エラー種別


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 69/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


=
Display name リネーム前ファイル名


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 70/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 6: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 7: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 71/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 8: 成功ページ数


Column name 成功ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 72/474


2026/01/17 0:58 Application Documentation


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 9: 失敗ページ数


Column name 失敗ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 10: 失敗ページ番号


Column name 失敗ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 73/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 11: エラー詳細情報


Column name エラー詳細情報


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 74/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 12: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 13: ステータス


Column name ステータス


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 75/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":[" 未対応 "," 対応中 "," 完

了 "],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"B
aseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Buttons","Valid_If":null,"Error_Message_If_Invalid":null,"S

how_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Su

ggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 14: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 76/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 読み取り成功分


Column name 読み取り成功分


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type List



Type Qualifier



{"ElementType":"Ref","ElementTypeQualifier":"
{\"ReferencedTableName\":\" 書類管理

T\",\"ReferencedRootTableName\":\" 書類管理
T\",\"ReferencedType\":\"Text\",\"ReferencedTypeQualifier\":\"
{\\\"MaxLength\\\":null,\\\"MinLength\\\":null,\\\"LongTextFor

matting\\\":\\\"Plain

Text\\\",\\\"IsMulticolumnKey\\\":false,\\\"Valid_If\\\":null,\\\"Er

ror_Message_If_Invalid\\\":null,\\\"Show_If\\\":null,\\\"Required

_If\\\":null,\\\"Editable_If\\\":null,\\\"Reset_If\\\":null,\\\"Sugges

ted_Values\\\":null}\",\"ReferencedKeyColumn\":\"ID\",\"IsAPart

Of\":false,\"RelationshipName\":null,\"InputMode\":\"Auto\",\"Va

lid_If\":null,\"Error_Message_If_Invalid\":null,\"Show_If\":null,\"R

equired_If\":null,\"Editable_If\":null,\"Reset_If\":null,\"Suggested

_Values\":null}","ItemSeparator":",

","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 77/474


2026/01/17 0:58 Application Documentation


=SELECT( 書類管理 T[ID], [ ファイル ID] = [_THISROW].[ ファイル
App formula
ID])


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 保守 T_Schema


Schema Name 保守 T_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 78/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: 監視日時


Column name 監視日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value NOW()


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 79/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No

## Column 3: システム状態


Column name システム状態


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: 処理ファイル数


Column name 処理ファイル数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 80/474


2026/01/17 0:58 Application Documentation


equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 5: エラー数


Column name エラー数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 81/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 6: 成功率 (%)


Column name 成功率 (%)


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Decimal



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"DecimalDigits":

0,"NumericDigits":null,"ShowThousandsSeparator":false,"Numbe

rDisplayMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":n

ull,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null

,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value 0


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 7: 問題概要


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 82/474


2026/01/17 0:58 Application Documentation


Column name 問題概要


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 詳細ステータス


Column name 詳細ステータス


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 83/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 9: チェック ID


Column name チェック ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 84/474


2026/01/17 0:58 Application Documentation

#### Schema Name ケアマネ M_Schema


Schema Name ケアマネ M_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: ケアマネ名


Column name ケアマネ名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 85/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only Yes


Hidden No


Label Yes


Spreadsheet formula "COMPUTED_VALUE"


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 担当 CMT_Schema


Schema Name 担当 CMT_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 86/474


2026/01/17 0:58 Application Documentation


equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: 顧客氏名


Column name 顧客氏名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? Yes


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 87/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: ケアマネ名


Column name ケアマネ名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only Yes


Hidden No


Label Yes


Spreadsheet formula =ArrayFormula(' ケアマネ M'!C[-1]:C[-1])


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 利用者情報 _Schema


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 88/474


2026/01/17 0:58 Application Documentation


Schema Name 利用者情報 _Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: _RowNumber


Column name _RowNumber


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Description Number of this row


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only Yes


Hidden Yes


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 2: 利用者名


Column name 利用者名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 89/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label Yes


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 利用者カナ


Column name 利用者カナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 90/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 4: 利用者生年月日


Column name 利用者生年月日


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


Initial value TODAY()


System Defined? No


Key No


Part of Key? Yes


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 5: 性別


Column name 性別


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 91/474


2026/01/17 0:58 Application Documentation


Type Enum



Type Qualifier



{"EnumValues":

[" 女 "," 男 "],"AllowOtherValues":true,"AutoCompleteOtherValues":tr
ue,"BaseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 6: 郵便番号


Column name 郵便番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 92/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable No


Scannable No


Sensitive data No

## Column 7: 都道府県


Column name 都道府県


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":[" 愛知県 "," 岐阜県 "," 三重

県 "],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"B
aseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 93/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 市区町村


Column name 市区町村


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 町名以下


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 94/474


2026/01/17 0:58 Application Documentation


Column name 町名以下


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data Yes

## Column 10: 建物名


Column name 建物名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 95/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data Yes


Column name 利用者電話番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 96/474


2026/01/17 0:58 Application Documentation


Column name 利用者携帯電話番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data Yes

## Column 13: 請求方法


Column name 請求方法


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 97/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 14: 請求送付先


Column name 請求送付先


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 98/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 15: 請求先氏名


Column name 請求先氏名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 16: 続柄


Column name 続柄


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 99/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No


Column name 請求先郵便番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 100/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No


Column name 請求先都道府県


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 19: 請求先市区町村


Column name 請求先市区町村


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 101/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 20: 請求先町名以下


Column name 請求先町名以下


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 102/474


2026/01/17 0:58 Application Documentation

Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 21: 請求先建物名


Column name 請求先建物名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No


Column name 請求先電話番号


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 103/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 23: 顧客番号


Column name 顧客番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 104/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 24: 銀行番号


Column name 銀行番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 25: 支店番号


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 105/474


2026/01/17 0:58 Application Documentation


Column name 支店番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 口座種別


Column name 口座種別


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":[" なし "," 普通預

金 "],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"B
aseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 106/474


2026/01/17 0:58 Application Documentation


w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 27: 口座番号


Column name 口座番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 107/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 28: 口座名義名カナ


Column name 口座名義名カナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 29: 利用者状態


Column name 利用者状態


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 108/474


2026/01/17 0:58 Application Documentation


Type Enum



Type Qualifier



{"EnumValues":[" 利用停止 "," 利用中 "," 一時停

止 "],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"B
aseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

## Column 30: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 109/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data Yes

## Column 31: _ComputedKey


Column name _ComputedKey


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":true,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



=CONCATENATE([ 利用者名 ],"_",TEXT([ 利用者生年月
App formula
日 ],"yyyymmdd"))


Read-Only Yes


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? Yes


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 110/474


2026/01/17 0:58 Application Documentation


Virtual? Yes


LocaleName ja-JP


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name Process for 書類情報の更新によるファイルリネーム - 1 Process Table_Schema


Process for 書類情報の更新によるファイルリネーム                   - 1
Schema Name
Process Table_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 111/474


2026/01/17 0:58 Application Documentation

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 112/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 113/474


2026/01/17 0:58 Application Documentation


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 114/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 115/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":" 顧客
M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 116/474


2026/01/17 0:58 Application Documentation


Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 117/474


2026/01/17 0:58 Application Documentation


\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 118/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 119/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 120/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 121/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 122/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 123/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 124/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 125/474


2026/01/17 0:58 Application Documentation


et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 126/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 127/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 128/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 129/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 130/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 131/474


2026/01/17 0:58 Application Documentation
## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 132/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 133/474


2026/01/17 0:58 Application Documentation


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 35: ファイルリネーム


Column name ファイルリネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":" ファイルリネーム

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 134/474


2026/01/17 0:58 Application Documentation


uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 36: 新しいファイル名を上書き


Column name 新しいファイル名を上書き


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 新しいファイル名を上書き

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 135/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 37: リネーム false


Column name リネーム false


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" リネーム false

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 136/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name ファイルリネーム Output_Schema


Schema Name ファイルリネーム Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 137/474


2026/01/17 0:58 Application Documentation

## Column 2: status


Column name status


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 3: newName


Column name newName


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 138/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 新しいファイル名を上書き Output_Schema


Schema Name 新しいファイル名を上書き Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 139/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 140/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 141/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 142/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 143/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 144/474


2026/01/17 0:58 Application Documentation


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 145/474


2026/01/17 0:58 Application Documentation


"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 146/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 147/474


2026/01/17 0:58 Application Documentation


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 148/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 149/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 150/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 151/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 152/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 153/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 154/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 155/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 156/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 157/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 158/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 159/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 160/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 161/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

#### Schema Name リネーム false Output_Schema


Schema Name リネーム false Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 162/474


2026/01/17 0:58 Application Documentation

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 163/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 164/474


2026/01/17 0:58 Application Documentation


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 165/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 166/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 167/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 168/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 169/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 170/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 171/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 172/474


2026/01/17 0:58 Application Documentation


equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 173/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 174/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 175/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 176/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 177/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 178/474


2026/01/17 0:58 Application Documentation
## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 179/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 180/474


2026/01/17 0:58 Application Documentation
## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 181/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 182/474


2026/01/17 0:58 Application Documentation


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 183/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 184/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 185/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

#### Schema Name Process for ファイルアップロード - 1 Process Table_Schema


Schema Name Process for ファイルアップロード    - 1 Process Table_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 186/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 187/474


2026/01/17 0:58 Application Documentation


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 188/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 189/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 190/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 191/474


2026/01/17 0:58 Application Documentation
## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 192/474


2026/01/17 0:58 Application Documentation


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 193/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 194/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 195/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 196/474


2026/01/17 0:58 Application Documentation
## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 197/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 198/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 199/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 200/474


2026/01/17 0:58 Application Documentation
## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 201/474


2026/01/17 0:58 Application Documentation


to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 202/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 203/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 204/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 205/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 206/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 207/474


2026/01/17 0:58 Application Documentation
## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 208/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 35: ファイルアップロード時処理


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 209/474


2026/01/17 0:58 Application Documentation


Column name ファイルアップロード時処理


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" ファイルアップロード時処理

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 36: URL やファイル名の入力


Column name URL やファイル名の入力


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":"URL やファイル名の入力

Output","ReferencedRootTableName":null,"ReferencedType":"Tex


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 210/474


2026/01/17 0:58 Application Documentation

t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name ファイルアップロード時処理 Output_Schema


Schema Name ファイルアップロード時処理 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 211/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: fileUrl


Column name fileUrl


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":null,"Valid_If":null,"Error_Message_If_Invalid":n

ull,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null

,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 212/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 3: newName


Column name newName


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: Key


Column name Key


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 213/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: fileId


Column name fileId


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 214/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: mimeType


Column name mimeType


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name URL やファイル名の入力 Output_Schema


Schema Name URL やファイル名の入力 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 215/474


2026/01/17 0:58 Application Documentation

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 216/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 217/474


2026/01/17 0:58 Application Documentation


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 218/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 219/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 220/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 221/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 222/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 223/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 224/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 225/474


2026/01/17 0:58 Application Documentation


equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 226/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 227/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 228/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 229/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 230/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 231/474


2026/01/17 0:58 Application Documentation
## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 232/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 233/474


2026/01/17 0:58 Application Documentation
## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 234/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 235/474


2026/01/17 0:58 Application Documentation


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 236/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 237/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 238/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

#### Schema Name Process for OCR 再読み込み準備 - 1 Process Table_Schema


Schema Name Process for OCR 再読み込み準備    - 1 Process Table_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 239/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 240/474


2026/01/17 0:58 Application Documentation


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 241/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 242/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 243/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 244/474


2026/01/17 0:58 Application Documentation
## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 245/474


2026/01/17 0:58 Application Documentation


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 246/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 247/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 248/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 249/474


2026/01/17 0:58 Application Documentation
## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 250/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 251/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 252/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 253/474


2026/01/17 0:58 Application Documentation
## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 254/474


2026/01/17 0:58 Application Documentation


to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 255/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 256/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 257/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 258/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 259/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 260/474


2026/01/17 0:58 Application Documentation
## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 261/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 262/474


2026/01/17 0:58 Application Documentation
## Column 35: 【 GAS 】「 OCR 対象書類」フォルダー に移動


Column name 【 GAS 】「 OCR 対象書類」フォルダーに移動


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 【 GAS 】「 OCR 対象書類」フォルダー

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 36: 当レコードを削除


Column name 当レコードを削除


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 263/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 当レコードを削除

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 【 GAS 】「 OCR 対象書類」フォルダーに移動 Output_Schema


Schema Name 【 GAS 】「 OCR 対象書類」フォルダーに移動 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 264/474


2026/01/17 0:58 Application Documentation


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name 当レコードを削除 Output_Schema


Schema Name 当レコードを削除 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 265/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 266/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 267/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 268/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 269/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 270/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 271/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 272/474


2026/01/17 0:58 Application Documentation


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 273/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 274/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 275/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 276/474


2026/01/17 0:58 Application Documentation


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 277/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 278/474


2026/01/17 0:58 Application Documentation


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 279/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 280/474


2026/01/17 0:58 Application Documentation
## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 281/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 282/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 283/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 284/474


2026/01/17 0:58 Application Documentation
## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 285/474


2026/01/17 0:58 Application Documentation


w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 286/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 287/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 288/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

#### Schema Name Process for 別ページ情報追加 Process Table_Schema


Schema Name Process for 別ページ情報追加 Process Table_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 289/474


2026/01/17 0:58 Application Documentation

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 290/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 291/474


2026/01/17 0:58 Application Documentation


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 292/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 293/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":" 顧客
M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 294/474


2026/01/17 0:58 Application Documentation


Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 295/474


2026/01/17 0:58 Application Documentation


\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 296/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 297/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 298/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 299/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 300/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 301/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 302/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 303/474


2026/01/17 0:58 Application Documentation


et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 304/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 305/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 306/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 307/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 308/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 309/474


2026/01/17 0:58 Application Documentation
## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 310/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 311/474


2026/01/17 0:58 Application Documentation


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 35: File タイプなど強制入力


Column name File タイプなど強制入力


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":"File タイプなど強制入力

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 312/474


2026/01/17 0:58 Application Documentation


uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 36: 別ページ情報追加クリア


Column name 別ページ情報追加クリア


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 別ページ情報追加クリア

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 313/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name File タイプなど強制入力 Output_Schema


Schema Name File タイプなど強制入力 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 314/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 315/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 316/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 317/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 318/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 319/474


2026/01/17 0:58 Application Documentation
## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 320/474


2026/01/17 0:58 Application Documentation


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 321/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 322/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 323/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 324/474


2026/01/17 0:58 Application Documentation
## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 325/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 326/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 327/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 328/474


2026/01/17 0:58 Application Documentation
## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


Type Qualifier {"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 329/474


2026/01/17 0:58 Application Documentation


to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 330/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 331/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 332/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 333/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 334/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 335/474


2026/01/17 0:58 Application Documentation
## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 336/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 337/474


2026/01/17 0:58 Application Documentation
#### Schema Name 別ページ情報追加クリア Output_Schema


Schema Name 別ページ情報追加クリア Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 338/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 339/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 340/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 341/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 342/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":" 顧客
M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 343/474


2026/01/17 0:58 Application Documentation


_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 344/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 345/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 346/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 347/474


2026/01/17 0:58 Application Documentation
## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 348/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 349/474


2026/01/17 0:58 Application Documentation
## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 350/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 351/474


2026/01/17 0:58 Application Documentation
## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 352/474


2026/01/17 0:58 Application Documentation


equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 353/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 354/474


2026/01/17 0:58 Application Documentation


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 355/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 356/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 357/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 358/474


2026/01/17 0:58 Application Documentation
## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 359/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 360/474


2026/01/17 0:58 Application Documentation


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

#### Schema Name Process for PDF 向き変更 - 1 Process Table_Schema


Schema Name Process for PDF 向き変更 - 1 Process Table_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 361/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 362/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 363/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 364/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 365/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 366/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 顧客

M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 367/474


2026/01/17 0:58 Application Documentation


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 368/474


2026/01/17 0:58 Application Documentation


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 369/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 370/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 371/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 372/474


2026/01/17 0:58 Application Documentation


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 373/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 374/474


2026/01/17 0:58 Application Documentation


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 375/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res

et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 376/474


2026/01/17 0:58 Application Documentation
## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 377/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 378/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 379/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 380/474


2026/01/17 0:58 Application Documentation
## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 381/474


2026/01/17 0:58 Application Documentation


w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 382/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 383/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 384/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 35: 【 GAS 】回転処理


Column name 【 GAS 】回転処理


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" 【 GAS 】回転処理

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 385/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 36: ファイル情報の更新と向き設定の初期 化


Column name ファイル情報の更新と向き設定の初期化


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" ファイル情報の更新と向き設定の初

期化

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 386/474


2026/01/17 0:58 Application Documentation

#### Schema Name 【 GAS 】回転処理 Output_Schema


Schema Name 【 GAS 】回転処理 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: fileId


Column name fileId


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 387/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: url


Column name url


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":null,"Valid_If":null,"Error_Message_If_Invalid":n

ull,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null

,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 388/474


2026/01/17 0:58 Application Documentation


Searchable No


Scannable No


Sensitive data No

#### Schema Name ファイル情報の更新と向き設定の初期化 Output_Schema


Schema Name ファイル情報の更新と向き設定の初期化 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: ID


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 389/474


2026/01/17 0:58 Application Documentation


Column name ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: 処理日時


Column name 処理日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 390/474


2026/01/17 0:58 Application Documentation


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 391/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: MIME タイプ


Column name MIME タイプ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 392/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: OCR 結果


Column name OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 8: 書類名


Column name 書類名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 393/474


2026/01/17 0:58 Application Documentation


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 書類 M[ 書類名 ], TRUE) +
LIST(\" その他 \", \" 未判定

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 9: 顧客名


Column name 顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref


Type Qualifier {"ReferencedTableName":" 顧客
M","ReferencedRootTableName":" 顧客
M","ReferencedType":"Text","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 394/474


2026/01/17 0:58 Application Documentation


ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference
dKeyColumn":" 顧客氏
名 ","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",
"Valid_If":"=SELECT( 顧客 M[ 顧客氏名 ], TRUE) + LIST(\" その他 \",

\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 10: 事業所名


Column name 事業所名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu
tMode":"Auto","Valid_If":"=SELECT( 事業所 M[ 事業所名 ], TRUE) +
LIST(\" その他 \", \" 未判定


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 395/474


2026/01/17 0:58 Application Documentation


\")","Error_Message_If_Invalid":null,"Show_If":null,"Required_If":n
ull,"Editable_If":null,"Reset_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 11: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type File



Type Qualifier



{"FolderLocation":"=OCR 移動
先 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 396/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 12: 日付


Column name 日付


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Date



Type Qualifier



{"UseLongDateFormat":false,"Valid_If":null,"Error_Message_If_In

valid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset

_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: 同姓同名フラグ


Column name 同姓同名フラグ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 397/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 14: 全顧客候補


Column name 全顧客候補


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 398/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 15: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 16: 対象ページ番号


Column name 対象ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 399/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 17: 該当ページの元テキスト（一部）


Column name 該当ページの元テキスト（一部）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 400/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 18: リネーム


Column name リネーム


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 変更する ","NoLabel":"= 変更しな

い ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":"=AN
D(ISNOTBLANK([ ファイル URL]), ISNOTBLANK([ 該当ページの元
テキスト（一

部） ]))","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 19: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 401/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 20: OCR 再読み込み


Column name OCR 再読み込み


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"","NoLabel":"","Valid_If":null,"Error_Message_If_Invali

d":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If"

:null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 402/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 21: 別ページ情報追加


Column name 別ページ情報追加


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 22: 回転角度


Column name 回転角度


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


Type Qualifier {"EnumValues":

["90","180","270"],"AllowOtherValues":false,"AutoCompleteOtherV
alues":true,"BaseType":"Number","BaseTypeQualifier":"
{\"MaxValue\":null,\"MinValue\":null,\"StepValue\":null,\"Numeri

cDigits\":null,\"ShowThousandsSeparator\":true,\"NumberDispl

ayMode\":\"Auto\",\"Valid_If\":null,\"Error_Message_If_Invalid\":

null,\"Show_If\":null,\"Required_If\":null,\"Editable_If\":null,\"Res


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 403/474


2026/01/17 0:58 Application Documentation


et_If\":null,\"Suggested_Values\":null}","EnumInputMode":"Butto

ns","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 23: ページ番号


Column name ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 404/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 24: （同姓同名時手動選択）顧客名 ID


Column name （同姓同名時手動選択）顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain
Text","IsMulticolumnKey":false,"Valid_If":"=SELECT( 利用者情報

[_ComputedKey], [ 利用者名 ] = [_THISROW].[ 顧客

名 ])","Error_Message_If_Invalid":null,"Show_If":"=LOOKUP([_THIS
ROW].[ 顧客名 ], \" 顧客 M\", \" 顧客氏名 \", \" 同姓同名 \") =

TRUE","Required_If":null,"Editable_If":null,"Reset_If":null,"Suggest

ed_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 25: URL


Column name URL


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 405/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 26: 【顧客】 OCR 結果


Column name 【顧客】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未登録顧客 ","NoLabel":"= 読み取り成

功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 406/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 27: 【書類】 OCR 結果


Column name 【書類】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 28: 【事業所】 OCR 結果


Column name 【事業所】 OCR 結果


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 407/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"YesLabel":"= 未判定 ","NoLabel":"= 読み取り成
功 ","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 29: 担当 CM


Column name 担当 CM


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 408/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 30: カテゴリー


Column name カテゴリー


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":

[],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"Bas
eType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Auto","Valid_If":null,"Error_Message_If_Invalid":null,"Sho

w_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sugg

ested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 409/474


2026/01/17 0:58 Application Documentation
## Column 31: 顧客名 ID


Column name 顧客名 ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 32: フリガナ


Column name フリガナ


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 410/474


2026/01/17 0:58 Application Documentation


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 33: カナ付き顧客名


Column name カナ付き顧客名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 34: 同姓同名


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 411/474


2026/01/17 0:58 Application Documentation


Column name 同姓同名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Yes/No



Type Qualifier



{"YesLabel":"=
有 ","NoLabel":"","Valid_If":null,"Error_Message_If_Invalid":null,"Sh

ow_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Sug

gested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

#### Schema Name Process for メールの添付ファイルから再取得
#### （ GAS ） - 1 Process Table_Schema


Process for メールの添付ファイルから再取得（ GAS ）                   - 1
Schema Name
Process Table_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 412/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: エラー ID


Column name エラー ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 413/474


2026/01/17 0:58 Application Documentation


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: エラー発生日時


Column name エラー発生日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 4: エラー種別


Column name エラー種別


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 414/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 415/474


2026/01/17 0:58 Application Documentation


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 7: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 416/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 8: 成功ページ数


Column name 成功ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 417/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 9: 失敗ページ数


Column name 失敗ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 10: 失敗ページ番号


Column name 失敗ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 418/474


2026/01/17 0:58 Application Documentation


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 11: エラー詳細情報


Column name エラー詳細情報


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 419/474


2026/01/17 0:58 Application Documentation


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 12: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 13: ステータス


Column name ステータス


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 420/474


2026/01/17 0:58 Application Documentation



Type Qualifier



{"EnumValues":[" 未対応 "," 対応中 "," 完

了 "],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"B
aseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Buttons","Valid_If":null,"Error_Message_If_Invalid":null,"S

how_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Su

ggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 14: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 421/474


2026/01/17 0:58 Application Documentation


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 読み取り成功分


Column name 読み取り成功分


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type List



Type Qualifier



{"ElementType":"Ref","ElementTypeQualifier":"
{\"ReferencedTableName\":\" 書類管理

T\",\"ReferencedRootTableName\":\" 書類管理
T\",\"ReferencedType\":\"Text\",\"ReferencedTypeQualifier\":\"
{\\\"MaxLength\\\":null,\\\"MinLength\\\":null,\\\"LongTextFor

matting\\\":\\\"Plain

Text\\\",\\\"IsMulticolumnKey\\\":false,\\\"Valid_If\\\":null,\\\"Er

ror_Message_If_Invalid\\\":null,\\\"Show_If\\\":null,\\\"Required

_If\\\":null,\\\"Editable_If\\\":null,\\\"Reset_If\\\":null,\\\"Sugges

ted_Values\\\":null}\",\"ReferencedKeyColumn\":\"ID\",\"IsAPart

Of\":false,\"RelationshipName\":null,\"InputMode\":\"Auto\",\"Va

lid_If\":null,\"Error_Message_If_Invalid\":null,\"Show_If\":null,\"R

equired_If\":null,\"Editable_If\":null,\"Reset_If\":null,\"Suggested

_Values\":null}","ItemSeparator":",

","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 422/474


2026/01/17 0:58 Application Documentation

System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 16: メールの添付ファイルから再取得 （ GAS ）


Column name メールの添付ファイルから再取得（ GAS ）


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" メールの添付ファイルから再取得

（ GAS ）

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 423/474


2026/01/17 0:58 Application Documentation

Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 17: ステータス完了


Column name ステータス完了


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Ref



Type Qualifier



{"ReferencedTableName":" ステータス完了

Output","ReferencedRootTableName":null,"ReferencedType":"Tex
t","ReferencedTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","Reference

dKeyColumn":"Instance

Id","IsAPartOf":false,"RelationshipName":null,"InputMode":"Auto",

"Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 424/474


2026/01/17 0:58 Application Documentation


Scannable No


Sensitive data No

#### Schema Name メールの添付ファイルから再取得（ GAS ） Output_Schema


Schema Name メールの添付ファイルから再取得（ GAS ） Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

#### Schema Name ステータス完了 Output_Schema


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 425/474


2026/01/17 0:58 Application Documentation


Schema Name ステータス完了 Output_Schema


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

## Column 1: Instance Id


Column name Instance Id


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key Yes


Part of Key? No


Fixed definition? No


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 2: エラー ID


Column name エラー ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 426/474


2026/01/17 0:58 Application Documentation


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 3: エラー発生日時


Column name エラー発生日時


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type DateTime



Type Qualifier



{"MinValue":null,"MaxValue":null,"UseLongDateFormat":false,"Ign

oreSeconds":false,"Valid_If":null,"Error_Message_If_Invalid":null,"

Show_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"S

uggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 427/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 4: エラー種別


Column name エラー種別


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 5: ファイル名


Column name ファイル名


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 428/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 6: ファイル ID


Column name ファイル ID


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 429/474


2026/01/17 0:58 Application Documentation
## Column 7: 総ページ数


Column name 総ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 8: 成功ページ数


Column name 成功ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 430/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 9: 失敗ページ数


Column name 失敗ページ数


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 431/474


2026/01/17 0:58 Application Documentation


Sensitive data No

## Column 10: 失敗ページ番号


Column name 失敗ページ番号


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Number



Type Qualifier



{"MaxValue":null,"MinValue":null,"StepValue":null,"NumericDigits"

:null,"ShowThousandsSeparator":true,"NumberDisplayMode":"Au

to","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"R

equired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Value

s":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable No


Scannable No


Sensitive data No

## Column 11: エラー詳細情報


Column name エラー詳細情報


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Text



Type Qualifier



{"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I

nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 432/474


2026/01/17 0:58 Application Documentation


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 12: ファイル URL


Column name ファイル URL


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Url



Type Qualifier



{"LaunchExternal":false,"IsHyperLink":false,"Valid_If":null,"Error_

Message_If_Invalid":null,"Show_If":null,"Required_If":null,"Editabl

e_If":null,"Reset_If":null,"Suggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 433/474


2026/01/17 0:58 Application Documentation
## Column 13: ステータス


Column name ステータス


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type Enum



Type Qualifier



{"EnumValues":[" 未対応 "," 対応中 "," 完

了 "],"AllowOtherValues":true,"AutoCompleteOtherValues":true,"B
aseType":"Text","BaseTypeQualifier":"
{\"MaxLength\":null,\"MinLength\":null,\"LongTextFormatting\":\

"Plain

Text\",\"IsMulticolumnKey\":false,\"Valid_If\":null,\"Error_Messa

ge_If_Invalid\":null,\"Show_If\":null,\"Required_If\":null,\"Editable

_If\":null,\"Reset_If\":null,\"Suggested_Values\":null}","EnumInpu

tMode":"Buttons","Valid_If":null,"Error_Message_If_Invalid":null,"S

how_If":null,"Required_If":null,"Editable_If":null,"Reset_If":null,"Su

ggested_Values":null}



Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 14: 備考


Column name 備考


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type LongText


Type Qualifier {"MaxLength":null,"MinLength":null,"LongTextFormatting":"Plain

Text","IsMulticolumnKey":false,"Valid_If":null,"Error_Message_If_I


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 434/474


2026/01/17 0:58 Application Documentation


nvalid":null,"Show_If":null,"Required_If":null,"Editable_If":null,"Res

et_If":null,"Suggested_Values":null}


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No

## Column 15: 読み取り成功分


Column name 読み取り成功分


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Type List



Type Qualifier



{"ElementType":"Ref","ElementTypeQualifier":"
{\"ReferencedTableName\":\" 書類管理

T\",\"ReferencedRootTableName\":\" 書類管理
T\",\"ReferencedType\":\"Text\",\"ReferencedTypeQualifier\":\"
{\\\"MaxLength\\\":null,\\\"MinLength\\\":null,\\\"LongTextFor

matting\\\":\\\"Plain

Text\\\",\\\"IsMulticolumnKey\\\":false,\\\"Valid_If\\\":null,\\\"Er

ror_Message_If_Invalid\\\":null,\\\"Show_If\\\":null,\\\"Required

_If\\\":null,\\\"Editable_If\\\":null,\\\"Reset_If\\\":null,\\\"Sugges

ted_Values\\\":null}\",\"ReferencedKeyColumn\":\"ID\",\"IsAPart

Of\":false,\"RelationshipName\":null,\"InputMode\":\"Auto\",\"Va

lid_If\":null,\"Error_Message_If_Invalid\":null,\"Show_If\":null,\"R

equired_If\":null,\"Editable_If\":null,\"Reset_If\":null,\"Suggested

_Values\":null}","ItemSeparator":",

","Valid_If":null,"Error_Message_If_Invalid":null,"Show_If":null,"Req

uired_If":null,"Editable_If":null,"Reset_If":null,"Suggested_Values":

null}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 435/474


2026/01/17 0:58 Application Documentation


Read-Only No


Hidden No


Label No


Formula version Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Reset on edit? No


System Defined? No


Key No


Part of Key? No


Fixed definition? Yes


Editable Initial
Yes
Value?


Virtual? No


Searchable Yes


Scannable No


Sensitive data No


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 436/474


2026/01/17 0:58 Application Documentation

## UX

### Views

#### View name 書類


View name 書類


Created by App owner


View type table


Position center



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":

["URL"," 処理日時 "," 対象ページ番号 "," 顧客名 "," 事業所名 "," 書類名 "," 日

付 "," ファイル名 "],"GroupBy":[{"Column":" カテゴリ

ー

","Order":"Ascending"},{"Column":" 書類名 ","Order":"Ascending"},
{"Column":" カナ付き顧客名 ","Order":"Ascending"},

{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"C
OUNT","SortBy":[{"Column":" 処理日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"fas fa
paste","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 事業所


View name 事業所


Created by App owner


View type table


Position left


View configuration {"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":

["URL"," 処理日時 "," 対象ページ番号 "," 顧客名 "," 事業所名 "," 書類名 "," 日

付 "," ファイル名 "],"GroupBy":[{"Column":" 事業所
名 ","Order":"Ascending"},{"Column":" カナ付き顧客

名 ","Order":"Ascending"},{"Column":" 書類名 ","Order":"Ascending"},
{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"C
OUNT","SortBy":[{"Column":" 処理日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 437/474


2026/01/17 0:58 Application Documentation


Selected","EventAction":"**auto**"}],"Icon":"fas fa
building","IconRunnerUps":null,"MenuOrder":1}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 顧客


View name 顧客


Created by App owner


View type table


Position left most



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":

["URL"," 処理日時 "," 対象ページ番号 "," 顧客名 "," 事業所名 "," 書類名 "," 日

付 "," ファイル名 "],"GroupBy":[{"Column":" カナ付き顧客

名 ","Order":"Ascending"},{"Column":" 書類名 ","Order":"Ascending"},
{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"C
OUNT","SortBy":[{"Column":" 処理日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"fas fa-fileuser","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 担当 CM


View name 担当 CM


Created by App owner


View type table


Position right


View configuration {"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":

["URL"," 処理日時 "," 対象ページ番号 "," 顧客名 "," 事業所名 "," 書類名 "," 日

付 "," ファイル名 "],"GroupBy":[{"Column":" 担当
CM","Order":"Ascending"},{"Column":" カナ付き顧客

名 ","Order":"Ascending"},{"Column":" カテゴリー ","Order":"Ascending"},
{"Column":" 書類名 ","Order":"Ascending"},
{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"C
OUNT","SortBy":[{"Column":" 処理日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 438/474


2026/01/17 0:58 Application Documentation


escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"fas fa-user
alt","IconRunnerUps":null,"MenuOrder":1}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name エラー履歴


View name エラー履歴


Created by App owner


View type table


Position menu



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":true,"ColumnOrder":[" エ
ラー発生日時 "," ファイル URL"," 失敗ページ番号 "," ステータス "," ファイ

ル名 "," 備考 "," エラー種別 "," 総ページ数 "," 成功ページ数 "," 失敗ページ

数 "," エラー詳細情報 "],"GroupBy":[{"Column":" ステータ

ス ","Order":"Ascending"},

{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"C
OUNT","SortBy":[{"Column":" エラー発生日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"far fa-exclamation
triangle","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 処理履歴


View name 処理履歴


Created by App owner


View type table


Position menu


View configuration {"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" 処
理日時 ","URL"," 顧客名 "," 事業所名 "," 書類名 "," 日付 "," ファイル名 ","ID"," フ

ァイル ID","MIME タイプ ","OCR 結果 "," 同姓同名フラグ "," 全顧客候補 "," 総

ページ数 "," 対象ページ番号 "," 該当ページの元テキスト（一部） "," リネ

ーム "," 備考 "],"GroupBy":[],"GroupAggregate":"NONE","SortBy":

[{"Column":" 処理日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 439/474


2026/01/17 0:58 Application Documentation


escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"fas fa
history","IconRunnerUps":null,"MenuOrder":2}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 書類 M


View name 書類 M


Created by App owner


View type table


Position menu



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" 書
類名 "],"GroupBy":[{"Column":" カテゴリー ","Order":"Ascending"},
{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"N

ONE","SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[{"EventType":"Row Selected","EventAction":"**auto**"}],"Icon":"far fafiles-medical","IconRunnerUps":null,"MenuOrder":3}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 事業所 M


View name 事業所 M


Created by App owner


View type table


Position menu



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" 事
業所名 "],"GroupBy":[],"GroupAggregate":"NONE","SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[{"EventType":"Row Selected","EventAction":"**auto**"}],"Icon":"far fa
building","IconRunnerUps":null,"MenuOrder":4}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 顧客 M


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 440/474


2026/01/17 0:58 Application Documentation


View name 顧客 M


Created by App owner


View type table


Position menu



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" 顧
客氏名 "," 顧客氏名（フリガナ） "," 同姓同名 "],"GroupBy":

[],"GroupAggregate":"NONE","SortBy":[{"Column":" 顧客氏名（フリガ
ナ） ","Order":"Ascending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"far fa
user","IconRunnerUps":null,"MenuOrder":5}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name Gmail 受信管理


View name Gmail 受信管理


Created by App owner


View type table


Position menu



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" フ
ァイル名 "," 処理日時 "," メール件名 "," ファイル URL"," メール本

文 "],"GroupBy":[],"GroupAggregate":"NONE","SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[{"EventType":"Row Selected","EventAction":"**auto**"}],"Icon":"far fa
envelope","IconRunnerUps":null,"MenuOrder":6}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name ヘルスチェック履歴


View name ヘルスチェック履歴


Created by App owner


View type table


Position menu


View configuration {"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" 監
視日時 "," システム状態 "," 処理ファイル数 "," エラー数 "," 成功率 (%)"," 問題

概要 "],"GroupBy":[],"GroupAggregate":"NONE","SortBy":[{"Column":" 監


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 441/474


2026/01/17 0:58 Application Documentation


時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"far fa-heart
rate","IconRunnerUps":null,"MenuOrder":7}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


View name 顧客同姓同名対応


Created by App owner


View type table


Position menu



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":

["URL"," 処理日時 "," 対象ページ番号 "," 顧客名 "," フリガナ "," 事業所名 "," 書

類名 "," 日付 "," ファイル名 "],"GroupBy":[{"Column":" 同姓同

名 ","Order":"Descending"},{"Column":" カナ付き顧客

名 ","Order":"Ascending"},{"Column":" 書類名 ","Order":"Ascending"},
{"Column":"_RowNumber","Order":"Ascending"}],"GroupAggregate":"C
OUNT","SortBy":[{"Column":" 処理日

時 ","Order":"Descending"}],"PrimarySortColumn":null,"IsPrimarySortD
escending":false,"Events":[{"EventType":"Row
Selected","EventAction":"**auto**"}],"Icon":"fas fa-fileuser","IconRunnerUps":null,"MenuOrder":8}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name Gmail 受信管理 T_Detail


View name Gmail 受信管理 T_Detail


Created by System


View type detail


ActionType Automatic


Position ref


View configuration {"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMode

":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"DesktopSpl


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 442/474


2026/01/17 0:58 Application Documentation


itMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name エラー履歴 T_Detail


View name エラー履歴 T_Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[" ステータス "," 備

考 "],"ColumnOrder":[" ステータス "," 備考 "," 失敗ページ番号 "," 読み取り

成功分 "," エラー発生日時 "," ファイル ID"," ファイル名 "," エラー種別 "," 総

ページ数 "," 成功ページ数 "," 失敗ページ数 "," エラー詳細情

報 "],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMo

de":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"Desktop

SplitMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name エラー履歴 T_Form


View name エラー履歴 T_Form


Created by System


View type form


Position ref



View configuration



{"ColumnOrder":null,"AutoSave":false,"AutoReopen":false,"FinishView"

:"**Automatic**","RowKey":"","FormStyle":"Automatic","PageStyle":"Aut

omatic","FormFooterStyle":"Bottom","MaxNestedRows":5,"AudioInput
":false,"Events":[{"EventType":"Form
Saved","EventAction":"**auto**"}],"Icon":"fa
edit","IconRunnerUps":null,"MenuOrder":1}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 443/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name ケアマネ M_Detail


View name ケアマネ M_Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMode

":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"DesktopSpl

itMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 事業所 M_Detail


View name 事業所 M_Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMode

":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"DesktopSpl

itMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 444/474


2026/01/17 0:58 Application Documentation
#### View name 保守 T_Detail


View name 保守 T_Detail


Created by System


View type detail


ActionType Automatic


Position ref


View configuration {"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[" 監視日時 "," システム状態 "," 処理ファイル数 "," エラー数 "," 成功率

(%)"," 問題概要 "," 詳細ステータス "," チェック

ID"],"ImageStyle":"Fill","Layout":{"style":

{"type":"style","backgroundColor":"transparent","boxSizing":"border
box","height":"100%","id":"18803ca8-6cbf-41d7-b090
4509e0201431","inspection":{"isInspectable":true,"eventHandlers":
{}}},"children":[{"style":{"type":"style","color":

{"type":"variable","value":"primaryText","id":"10ee5459-af8f-45ac
b486-193a9968c81e","inspection":

{"isInspectable":true,"eventHandlers":
{}}},"height":"100%","display":"flex","flexDirection":"column","justifyCont

ent":"space-between","background":

{"type":"variable","value":"mainContentBackground","id":"847233a2
0243-4f05-ac39-9d608383512f","inspection":

{"isInspectable":true,"eventHandlers":{}}},"fontSize":14,"id":"0ed6623e
e7c8-4fc6-af1f-01adbfb245a0","inspection":
{"isInspectable":true,"eventHandlers":{}}},"children":[{"value":" 成功率
(%)","child":{"id":"media","type":"circleProgress","style":
{"type":"style","width":"100%","height":194,"borderRadius":"4px 4px 0

0","objectFit":"cover","id":"3a9f1a4f-a1c1-4e0b-b789
dcf4b8995969","inspection":{"isInspectable":true,"eventHandlers":

{}}},"inspection":{"isInspectable":true,"eventHandlers":

{}}},"id":"mainImage","type":"binding","inspection":

{"isInspectable":true,"eventHandlers":{}}},{"style":

{"type":"style","padding":16,"id":"1952f7b5-313e-437a-9465
0813d6ddc9d9","inspection":{"isInspectable":true,"eventHandlers":
{}}},"children":[{"value":" 監視日時 ","child":

{"id":"label","type":"text","style":

{"type":"style","fontSize":21,"lineHeight":1.15,"id":"97559953-75d9
4b10-919d-c416d183b4c9","inspection":

{"isInspectable":true,"eventHandlers":{}}},"inspection":

{"isInspectable":true,"eventHandlers":{}}},"id":"c6a3a013-0faf-4db7
8829-39efc6704784","type":"binding","inspection":


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 445/474


2026/01/17 0:58 Application Documentation


{"isInspectable":true,"eventHandlers":{}}},{"value":" システム状
態 ","child":{"id":"subheader","type":"text","style":

{"type":"style","fontSize":14,"opacity":0.6,"paddingTop":4,"overflow":"hi

dden","id":"f3a98f74-a901-451b-9b64-8c00e5632325","inspection":

{"isInspectable":true,"eventHandlers":{}}},"inspection":

{"isInspectable":true,"eventHandlers":{}}},"id":"bba2d2cb-c355-43aa
a0a3-46e89a578400","type":"binding","inspection":

{"isInspectable":true,"eventHandlers":
{}}}],"id":"headerTextContainer","type":"container","inspection":
{"isInspectable":true,"eventHandlers":{}}},{"value":" 問題概要 ","child":

{"id":"description","type":"text","style":

{"type":"style","fontSize":14,"padding":16,"paddingTop":8,"maxHeight":
100,"overflow":"hidden","id":"f3a98f74-a901-451b-9b648c00e5632327","inspection":{"isInspectable":true,"eventHandlers":

{}}},"inspection":{"isInspectable":true,"eventHandlers":

{}}},"id":"bba2d2cb-c355-43aa-a0a3
46e89a5783d0","type":"binding","inspection":

{"isInspectable":true,"eventHandlers":{}}},{"style":
{"type":"style","display":"flex","alignItems":"center","justifyContent":"sp

ace
between","padding":8,"paddingTop":0,"paddingBottom":0,"id":"5fa06ef

2-6010-4c1e-aa84-668f8ac967aa","inspection":
{"isInspectable":true,"eventHandlers":{}}},"children":[{"value":"Action

1","child":{"id":"Action 1","type":"text","onClick":

{"type":"action","id":"8faa486e-80a1-4bf8-9911
ff05823f7018","inspection":{"isInspectable":true,"eventHandlers":

{}}},"style":

{"type":"variable","value":"actionButtonTextStyle","id":"4fcb9585-70b2
4bc0-a407-be6849bea1a7","inspection":

{"isInspectable":true,"eventHandlers":{}}},"inspection":

{"isInspectable":true,"eventHandlers":{}}},"id":"c503ebe1-33d7-49e6
979d-a4f4a0345863","type":"constant","inspection":

{"isInspectable":true,"eventHandlers":{}}},{"value":"Action 2","child":

{"id":"Action 2","type":"text","onClick":{"type":"action","id":"fb9d48ba
a444-4617-8859-7065b058efac","inspection":

{"isInspectable":true,"eventHandlers":{}}},"style":

{"type":"variable","value":"actionButtonTextStyle","id":"77f5bd38-248e
4f75-bf97-18e3b5c54d50","inspection":

{"isInspectable":true,"eventHandlers":{}}},"inspection":

{"isInspectable":true,"eventHandlers":{}}},"id":"63cee5fc-bcf9-4cce
bcfe-d330b69732b9","type":"constant","inspection":

{"isInspectable":true,"eventHandlers":{}}},{"style":
{"type":"style","display":"flex","alignItems":"center","marginLeft":"auto","


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 446/474


2026/01/17 0:58 Application Documentation


id":"ff7fc872-bf93-4502-963e-ecfc16771fd8","inspection":
{"isInspectable":true,"eventHandlers":{}}},"children":[{"value":"far fa
heart","child":{"id":"Action 3","type":"icon","onClick":

{"type":"action","id":"c49470ae-b53e-4109-9bb7
d85a93cd0fdf","inspection":{"isInspectable":true,"eventHandlers":

{}}},"style":

{"type":"variable","value":"actionButtonIconStyle","id":"cd0faa93-c489
4d7b-bcd9-c8dd3e551dd1","inspection":

{"isInspectable":true,"eventHandlers":{}}},"inspection":

{"isInspectable":true,"eventHandlers":{}}},"id":"45097ee1-733e-4faa
b049-2e9be8ba402b","type":"constant","inspection":

{"isInspectable":true,"eventHandlers":{}}},{"value":"fas fa-share
alt","child":{"id":"Action 4","type":"icon","onClick":

{"type":"action","id":"aaba7aa9-9bc5-4ca5-aef0
0e834f3b26e2","inspection":{"isInspectable":true,"eventHandlers":

{}}},"style":

{"type":"variable","value":"actionButtonIconStyle","id":"441cc05d
5e46-4753-bd34-6053ef27f305","inspection":

{"isInspectable":true,"eventHandlers":{}}},"inspection":

{"isInspectable":true,"eventHandlers":{}}},"id":"5205cdc0-a69d-4f46
9a0a-4cc48950745a","type":"constant","inspection":
{"isInspectable":true,"eventHandlers":{}}}],"id":"65eb11c1-7b76-4565
9284-94d6783d8ec0","type":"container","inspection":
{"isInspectable":true,"eventHandlers":{}}}],"variables":

[{"name":"actionButtonTextStyle","value":
{"type":"style","maxHeight":60,"maxWidth":100,"display":"flex","alignIte
ms":"center","overflow":"hidden","overflowWrap":"break
word","textTransform":"uppercase","fontSize":12,"cursor":"pointer","col

or":

{"type":"variable","value":"actionIcon"},"border":5,"padding":8,"transitio

n":"background 0.8s","hover":{"type":"style","background":

{"type":"variable","value":"mainBackgroundVariant"},"transition":"back

ground 0.8s"},"down":{"type":"style","background":

{"type":"variable","value":"mainBackgroundVariant"},"transition":"back

ground 0.8s"}}},{"name":"actionButtonIconStyle","value":

{"type":"style","fontSize":16,"color":

{"type":"variable","value":"secondaryText"},"border":"50%","cursor":"poi

nter","padding":8,"transition":"background 0.8s","hover":

{"type":"style","background":

{"type":"variable","value":"mainBackgroundVariant"},"transition":"back

ground 0.8s"},"down":{"type":"style","background":

{"type":"variable","value":"mainBackgroundVariant"},"transition":"back
ground 0.8s"}}}],"id":"2a07cf3b-cdec-4e45-90cb

https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 447/474


2026/01/17 0:58 Application Documentation


f2b2e14dae8d","type":"container","inspection":
{"isInspectable":true,"eventHandlers":{}}}],"id":"55f59616-6c4f-48c8
88cc-1edd8388e4c9","type":"container","inspection":
{"isInspectable":true,"eventHandlers":{}}}],"name":"detail","variables":

[{"name":"imageName","value":"https://www.appsheet.com/Content/

editor/img/empty-media-template.png"},

{"name":"labelName","value":"Title goes
here"}],"version":0,"id":"52405288-3f27-45d7-8c68
c7d489a76db4","type":"container","inspection":

{"isInspectable":true,"eventHandlers":

{}}},"UseCardLayout":false,"DisplayMode":"Automatic","MaxNestedRo

ws":5,"SlideshowMode":true,"DesktopSplitMode":"Split

view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 利用者情報 _Detail


View name 利用者情報 _Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMode

":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"DesktopSpl

itMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 担当 CMT_Detail


View name 担当 CMT_Detail


Created by System


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 448/474


2026/01/17 0:58 Application Documentation


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMode

":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"DesktopSpl

itMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 書類 M_Detail


View name 書類 M_Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[" 書類名 "," カテゴリ

ー

"],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMo

de":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"Desktop

SplitMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 書類 M_Form


View name 書類 M_Form


Created by System


View type form


Position ref


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 449/474


2026/01/17 0:58 Application Documentation



View configuration



{"ColumnOrder":[" 書類名 "," カテゴリ

ー
"],"AutoSave":false,"AutoReopen":false,"FinishView":"**Automatic**"

,"RowKey":"","FormStyle":"Automatic","PageStyle":"Automatic","FormF

ooterStyle":"Bottom","MaxNestedRows":5,"AudioInput":false,"Events":

[{"EventType":"Form Saved","EventAction":"**auto**"}],"Icon":"fa
edit","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 書類管理 T_Detail


View name 書類管理 T_Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[" 顧客名 "],"QuickEditColumns":[" （同姓同

名時手動選択）顧客名 ID"],"ColumnOrder":[" 顧客名 ID"," （同姓同名時

手動選択）顧客名 ID"," 担当 CM"," 処理日時 "," 対象ページ番号 "," カテゴ

リー "," 書類名 "," 事業所名 "," 日付 "," ファイル名 "," 総ページ数 "," 備考 ","OCR

結

果 "],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMo

de":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"Desktop

SplitMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 書類管理 T_Form


View name 書類管理 T_Form


Created by System


View type form


Position ref


View configuration {"ColumnOrder":[" 顧客名 "," 書類名 "," 事業所名 "," 日付 "," 備考 "," リネー
ム "," 対象ページ番号 "," ファイル

URL"],"AutoSave":false,"AutoReopen":false,"FinishView":"**Automatic*


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 450/474


2026/01/17 0:58 Application Documentation


*","RowKey":"","FormStyle":"Automatic","PageStyle":"Automatic","Form

FooterStyle":"Bottom","MaxNestedRows":5,"AudioInput":false,"Events
":[{"EventType":"Form Saved","EventAction":"**auto**"}],"Icon":"fa
edit","IconRunnerUps":null,"MenuOrder":1}


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 書類管理 T_Inline


View name 書類管理 T_Inline


Created by System


View type table


Position ref



View configuration



{"ColumnWidth":"Default","EnableQuickEdit":false,"ColumnOrder":[" 顧
客名 "," 書類名 "," ファイル名 "," ファイル URL","URL"," 処理日時 "," 事業所
名 "," 総ページ数 "," 対象ページ番号 "," 担当 CM"," カテゴリー "],"GroupBy":

[],"GroupAggregate":"NONE","SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[{"EventType":"Row Selected","EventAction":"**auto**"}],"Icon":"fa
table","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### View name 顧客 M_Detail


View name 顧客 M_Detail


Created by System


View type detail


ActionType Automatic


Position ref



View configuration



{"MainSlideshowImageColumn":"**auto**","DetailContentColumn":"**
none**","HeaderColumns":[],"QuickEditColumns":[],"ColumnOrder":

[],"ImageStyle":"Fill","Layout":null,"UseCardLayout":false,"DisplayMode

":"Automatic","MaxNestedRows":5,"SlideshowMode":true,"DesktopSpl

itMode":"Split view","UseDesktopMultiColumn":true,"SortBy":

[],"PrimarySortColumn":null,"IsPrimarySortDescending":false,"Events"
:[],"Icon":"fa-indent","IconRunnerUps":null,"MenuOrder":1}



Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 451/474


2026/01/17 0:58 Application Documentation


Icon 


Menu order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

### Format Rules

#### Rule name システム状態（正常稼働）


Rule name システム状態（正常稼働）


Format these columns and

actions


For this data 保守 T


If this condition is true =[ システム状態 ] = " 正常稼働 "


Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlConte
Rule order
nt


Is this format rule disabled? No



Like this



{"textColor":"green","highlightColor":"","textSize":1.0,"underlin

e":false,"strikethrough":false,"bold":false,"italic":false,"upperc

ase":false,"icon":null,"imageSize":null}



Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlConte
Visible?
nt

#### Rule name システム状態（注意監視）


Rule name システム状態（注意監視）


Format these columns and

actions


For this data 保守 T


If this condition is true =[ システム状態 ] = " 注意監視 "


Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlConte
Rule order
nt


Is this format rule disabled? No



Like this



{"textColor":"yellow","highlightColor":"","textSize":1.0,"underli

ne":false,"strikethrough":false,"bold":false,"italic":false,"uppe

rcase":false,"icon":null,"imageSize":null}



Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlConte
Visible?
nt

#### Rule name システム状態（要対応）


Rule name システム状態（要対応）


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 452/474


2026/01/17 0:58 Application Documentation


Format these columns and

actions


For this data 保守 T


If this condition is true =[ システム状態 ] = " 要対応 "


Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlConte
Rule order
nt


Is this format rule disabled? No



Like this



{"textColor":"red","highlightColor":"","textSize":1.0,"underline":

false,"strikethrough":false,"bold":true,"italic":false,"uppercas

e":false,"icon":null,"imageSize":null}



Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlConte
Visible?
nt


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 453/474


2026/01/17 0:58 Application Documentation

## Behavior

### Actions

#### Action name Delete


Action name Delete


Bulk action? Yes


Modifies data? Yes

Needs confirmation? Yes


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"InputParametersUsed":null,"Prominence":"Display_Prominently
","NeedsConfirmation":true,"ConfirmationMessage":"","ModifiesD
ata":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

Only if this condition is =CONTEXT("View") <> " 顧客 "
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Edit


Action name Edit


Bulk action? No


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"DesktopBehavior":"Open a form","DesktopEditBehavior":"Edit in
place","Prominence":"Do_Not_Display","NeedsConfirmation":fals
e,"ConfirmationMessage":"","ModifiesData":true,"BulkApplicable":
false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 454/474


2026/01/17 0:58 Application Documentation


Disable automatic
No
updates?


Display name 編集


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Add


Action name Add


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


{"Prominence":"Display_Overlay","NeedsConfirmation":false,"Con
With these properties
firmationMessage":"","ModifiesData":true,"BulkApplicable":true}


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

Yes
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Delete


Action name Delete


Bulk action? Yes


Modifies data? Yes

Needs confirmation? Yes


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"InputParametersUsed":null,"Prominence":"Display_Prominently
","NeedsConfirmation":true,"ConfirmationMessage":"","ModifiesD
ata":true,"BulkApplicable":true}



https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 455/474


2026/01/17 0:58 Application Documentation


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Disable automatic
No
updates?


Action icon 


For a record of this table 書類 M


Does this action apply to
No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Edit


Action name Edit


Bulk action? No


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"DesktopBehavior":"Open a form","DesktopEditBehavior":"Edit in
place","Prominence":"Display_Overlay","NeedsConfirmation":fals
e,"ConfirmationMessage":"","ModifiesData":true,"BulkApplicable":
false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Disable automatic
No
updates?


Action icon 


For a record of this table 書類 M


Does this action apply to
No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Add


Action name Add


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 456/474


2026/01/17 0:58 Application Documentation

{"Prominence":"Display_Overlay","NeedsConfirmation":false,"Con
With these properties
firmationMessage":"","ModifiesData":true,"BulkApplicable":true}


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Disable automatic
No
updates?


Action icon 


For a record of this table 書類 M


Does this action apply to
Yes
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Open Url (URL)


Action name Open Url (URL)


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"NavigateTarget":"

[URL]","LaunchExternal":false,"Prominence":"Display_Prominentl
y","NeedsConfirmation":false,"ConfirmationMessage":"","Modifie
sData":false,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column URL


Set this column URL


Only if this condition is
NOT(ISBLANK([URL]))
true


Disable automatic
No
updates?


Display name 閲覧


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name URL やファイル名の入力 Action - 1


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 457/474


2026/01/17 0:58 Application Documentation


Action name URL やファイル名の入力 Action - 1


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" ファイル
URL","NewColumnValue":"=[ ファイルアップロード時処理 ].

[fileUrl]"},{"ColumnToEdit":" ファイル名 ","NewColumnValue":"=[ フ
ァイルアップロード時処理 ].[newName]"},{"ColumnToEdit":" ファ
イル ID","NewColumnValue":"=[ ファイルアップロード時処理 ].

[fileId]"},{"ColumnToEdit":"MIME タイプ ","NewColumnValue":"=

[ ファイルアップロード時処理 ].

[mimeType]"}],"ColumnToEdit":" ファイル
URL","NewColumnValue":"=[ ファイルアップロード時処理 ].

[fileUrl]","InputParametersUsed":null,"Prominence":"Display_Pro
minently","NeedsConfirmation":false,"ConfirmationMessage":"","
ModifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル URL


Set this column ファイル URL


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =[ ファイルアップロード時処理 ].[fileUrl]


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Open File ( ファイル URL)


Action name Open File ( ファイル URL)


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 458/474


2026/01/17 0:58 Application Documentation


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"FileTarget":"[ ファイル
URL]","Prominence":"Display_Inline","NeedsConfirmation":false,"
ConfirmationMessage":"","ModifiesData":false,"BulkApplicable":f
alse}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル URL


Set this column ファイル URL


Only if this condition is
NOT(ISBLANK([ ファイル URL]))
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Open Url ( ファイル URL)


Action name Open Url ( ファイル URL)


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"NavigateTarget":"[ ファイル
URL]","LaunchExternal":false,"Prominence":"Display_Inline","Nee
dsConfirmation":false,"ConfirmationMessage":"","ModifiesData":
false,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル URL


Set this column ファイル URL


Only if this condition is
NOT(ISBLANK([ ファイル URL]))
true


Disable automatic
No
updates?


Action icon 


For a record of this table Gmail 受信管理 T


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 459/474


2026/01/17 0:58 Application Documentation


Does this action apply to
No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Open Url (URL) 2


Action name Open Url (URL) 2


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"NavigateTarget":"

[URL]","LaunchExternal":false,"Prominence":"Display_Inline","Nee
dsConfirmation":false,"ConfirmationMessage":"","ModifiesData":
false,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column URL


Only if this condition is
NOT(ISBLANK([URL]))
true


Disable automatic
No
updates?


Display name 閲覧


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name リネーム true


Action name リネーム true


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


With these properties {"Assignments":[{"ColumnToEdit":" リネー
ム ","NewColumnValue":"=TRUE"}],"ColumnToEdit":" リネー


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 460/474


2026/01/17 0:58 Application Documentation


ム ","NewColumnValue":"=TRUE","InputParametersUsed":null,"Pro
minence":"Do_Not_Display","NeedsConfirmation":false,"Confirm
ationMessage":"","ModifiesData":true,"BulkApplicable":true}


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column リネーム


Set this column リネーム


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =TRUE


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name ファイル名を変更


Action name ファイル名を変更


Bulk action? No


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Actions":[{"ActionName":" リネーム true"},
{"ActionName":"Edit"}],"Prominence":"Display_Prominently","Nee
dsConfirmation":false,"ConfirmationMessage":"","ModifiesData":t
rue,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 461/474


2026/01/17 0:58 Application Documentation
#### Action name リネーム false Action - 1


Action name リネーム false Action - 1


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" リネー
ム ","NewColumnValue":"=FALSE"}],"ColumnToEdit":" リネー

ム ","NewColumnValue":"=FALSE","InputParametersUsed":null,"Pr
ominence":"Display_Prominently","NeedsConfirmation":false,"Co
nfirmationMessage":"","ModifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column リネーム


Set this column リネーム


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =FALSE


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name リネーム false


Action name リネーム false


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


With these properties {"Assignments":[{"ColumnToEdit":" リネー
ム ","NewColumnValue":"=FALSE"}],"ColumnToEdit":" リネー

ム ","NewColumnValue":"=FALSE","InputParametersUsed":null,"Pr


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 462/474


2026/01/17 0:58 Application Documentation

ominence":"Do_Not_Display","NeedsConfirmation":false,"Confir
mationMessage":"","ModifiesData":true,"BulkApplicable":true}


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column リネーム


Set this column リネーム


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =FALSE


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name 編集


Action name 編集


Bulk action? No


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Actions":[{"ActionName":" リネーム false"},
{"ActionName":"Edit"}],"Prominence":"Display_Prominently","Nee
dsConfirmation":false,"ConfirmationMessage":"","ModifiesData":t
rue,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 463/474


2026/01/17 0:58 Application Documentation
#### Action name 新しいファイル名を上書き Action - 1


Action name 新しいファイル名を上書き Action - 1


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" ファイル
名 ","NewColumnValue":"=IF([ ファイルリネーム ].[status] = TRUE,

[ ファイルリネーム ].[newName], [ ファイル
名 ])"}],"ColumnToEdit":" ファイル名 ","NewColumnValue":"=IF([ フ
ァイルリネーム ].[status] = TRUE, [ ファイルリネーム ].

[newName], [ ファイル
名 ])","InputParametersUsed":null,"Prominence":"Display_Promin
ently","NeedsConfirmation":false,"ConfirmationMessage":"","Mod
ifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル名


Set this column ファイル名


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


=IF([ ファイルリネーム ].[status] = TRUE, [ ファイルリネーム ].
To this value

[newName], [ ファイル名 ])


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name 再読み込み


Action name 再読み込み


Bulk action? Yes


【 ※ 処理上限は 20 件まで】再読み込み準備をします（完了まで
Confirmation Message

数分かかります）


Modifies data? Yes

Needs confirmation? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 464/474


2026/01/17 0:58 Application Documentation


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":"OCR 再読み込
み ","NewColumnValue":"=TRUE"}],"ColumnToEdit":"OCR 再読み込

み ","NewColumnValue":"=TRUE","InputParametersUsed":null,"Pro
minence":"Display_Prominently","NeedsConfirmation":true,"Confi
rmationMessage":" 【 ※ 処理上限は 20 件まで】再読み込み準備を

します（完了まで数分かかりま
す） ","ModifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column OCR 再読み込み


Set this column OCR 再読み込み


Only if this condition is =[ 顧客名 ] = " 未登録顧客 "
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =TRUE


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name 当レコードを削除 Action - 1


Action name 当レコードを削除 Action - 1


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"InputParametersUsed":null,"Prominence":"Display_Prominently
","NeedsConfirmation":false,"ConfirmationMessage":"","Modifies
Data":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Only if this condition is
true
true


Disable automatic
No
updates?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 465/474


2026/01/17 0:58 Application Documentation


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name 別ページ情報追加


Action name 別ページ情報追加


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"NavigateTarget":"=LINKTOFORM(\n \" 書類管理 T_Form\",\n
\" ファイル URL\",\n [_THISROW].[ ファイル URL],\n \"MIME タイ

プ \",\n [_THISROW].[MIME タイプ ],\n \"OCR 結果 \",\n

[_THISROW].[OCR 結果 ],\n \" 総ページ数 \",\n [_THISROW].[ 総ペ

ージ数 ],\n \" 別ページ情報追加 \",\n CONCATENATE(\n

[_THISROW].[ ファイル URL],\n \",\",\n [_THISROW].[ ファイル
名 ],\n \",\",\n [_THISROW].[ ファイル ID]\n
)\n)","Prominence":"Display_Prominently","NeedsConfirmation":f
alse,"ConfirmationMessage":"","ModifiesData":false,"BulkApplica
ble":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ID


Only if this condition is =[ 顧客名 ] <> " 未登録顧客 "
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =TRUE


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Action for File タイプなど強制入力


Action name Action for File タイプなど強制入力


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 466/474


2026/01/17 0:58 Application Documentation


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" ファイル
URL","NewColumnValue":"=INDEX(SPLIT([ 別ページ情報追加 ],
\",\"), 1)"},{"ColumnToEdit":" ファイル

名 ","NewColumnValue":"=INDEX(SPLIT([ 別ページ情報追加 ],
\",\"), 2)"},{"ColumnToEdit":" ファイル

ID","NewColumnValue":"=INDEX(SPLIT([ 別ページ情報追加 ],
\",\"), 3)"}],"ColumnToEdit":" ファイル

URL","NewColumnValue":"=INDEX(SPLIT([ 別ページ情報追加 ],
\",\"),

1)","InputParametersUsed":null,"Prominence":"Display_Prominen
tly","NeedsConfirmation":false,"ConfirmationMessage":"","Modifi
esData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル URL


Set this column ファイル URL


Only if this condition is
true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =INDEX(SPLIT([ 別ページ情報追加 ], ","), 1)


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name 別ページ情報追加クリア Action - 1


Action name 別ページ情報追加クリア Action - 1


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 467/474


2026/01/17 0:58 Application Documentation



With these properties



{"Assignments":[{"ColumnToEdit":" 別ページ情報追
加 ","NewColumnValue":"=\"\""}],"ColumnToEdit":" 別ページ情報追

加 ","NewColumnValue":"=\"\"","InputParametersUsed":null,"Promi
nence":"Display_Prominently","NeedsConfirmation":false,"Confir
mationMessage":"","ModifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column 別ページ情報追加


Set this column 別ページ情報追加


Only if this condition is

true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =""


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Open Url ( ファイル URL)


Action name Open Url ( ファイル URL)


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"NavigateTarget":"[ ファイル
URL]","LaunchExternal":false,"Prominence":"Display_Prominently
","NeedsConfirmation":false,"ConfirmationMessage":"","Modifies
Data":false,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル URL


Set this column ファイル URL


Only if this condition is
NOT(ISBLANK([ ファイル URL]))
true


Disable automatic
No
updates?


Display name エラーファイルを開く


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 468/474


2026/01/17 0:58 Application Documentation


Action icon 


For a record of this table エラー履歴 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Edit


Action name Edit


Bulk action? No


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"DesktopBehavior":"Open a form","DesktopEditBehavior":"Edit in
place","Prominence":"Display_Overlay","NeedsConfirmation":fals
e,"ConfirmationMessage":"","ModifiesData":true,"BulkApplicable":
false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Only if this condition is
=CONTEXT("View") <> " エラー履歴 T_Detail"
true


Disable automatic
No
updates?


Action icon 


For a record of this table エラー履歴 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Open Url ( ファイル URL) 2


Action name Open Url ( ファイル URL) 2


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


With these properties {"NavigateTarget":"[ ファイル
URL]","LaunchExternal":false,"Prominence":"Display_Inline","Nee


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 469/474


2026/01/17 0:58 Application Documentation

dsConfirmation":false,"ConfirmationMessage":"","ModifiesData":
false,"BulkApplicable":false}


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ファイル URL


Only if this condition is
NOT(ISBLANK([ ファイル URL]))
true


Disable automatic
No
updates?


Action icon 


For a record of this table エラー履歴 T


Does this action apply to

No
the whole table?


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name PDF 回転


Action name PDF 回転


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" 回転角
度 ","NewColumnValue":"=[_INPUT].[ 回転角度 ]"},

{"ColumnToEdit":" ページ番号 ","NewColumnValue":"=[_INPUT].

[ 対象ページ ]"}],"ColumnToEdit":" 回転角度 ","NewColumnValue":"=

[_INPUT].[ 回転角

度 ]","InputParametersUsed":null,"Prominence":"Display_Promine
ntly","NeedsConfirmation":false,"ConfirmationMessage":"","Modif
iesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column 回転角度


Set this column 回転角度


Only if this condition is =CONTEXT("View") <> " 顧客 "
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 470/474


2026/01/17 0:58 Application Documentation


Does this action apply to
No
the whole table?


To this value =[_INPUT].[ 回転角度 ]


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name Action for ファイル情報の更新と向き設定の初期化


Action name Action for ファイル情報の更新と向き設定の初期化


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" 回転角
度 ","NewColumnValue":"=\"\""},{"ColumnToEdit":" ページ番

号 ","NewColumnValue":"=\"\""},{"ColumnToEdit":" ファイル
ID","NewColumnValue":"=[ 【 GAS 】回転処理 ].[fileId]"},
{"ColumnToEdit":" ファイル URL","NewColumnValue":"=[ 【 GAS 】回
転処理 ].[url]"}],"ColumnToEdit":" 回転角

度 ","NewColumnValue":"=\"\"","InputParametersUsed":null,"Promi
nence":"Display_Prominently","NeedsConfirmation":false,"Confir
mationMessage":"","ModifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column 回転角度


Set this column 回転角度


Only if this condition is

true
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


To this value =""


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name 再取得


Action name 再取得


Bulk action? Yes


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 471/474


2026/01/17 0:58 Application Documentation

Confirmation Message メールの添付ファイルから再取得します。

Modifies data? Yes

Needs confirmation? Yes


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"Assignments":[{"ColumnToEdit":" 備
考 ","NewColumnValue":"=\" メールの添付ファイルから再取得

（ GAS ） \""}],"ColumnToEdit":" 備考 ","NewColumnValue":"=\" メー

ルの添付ファイルから再取得（ GAS ）

\"","InputParametersUsed":null,"Prominence":"Display_Prominent
ly","NeedsConfirmation":true,"ConfirmationMessage":" メールの
添付ファイルから再取得しま
す。 ","ModifiesData":true,"BulkApplicable":true}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column 備考


Set this column 備考


Only if this condition is
=AND([ ステータス ] <> " 完了 ", [ エラー種別 ] <> "OCR 部分失敗 ")
true


Disable automatic
No
updates?


Action icon 


For a record of this table エラー履歴 T


Does this action apply to

No
the whole table?


To this value =" メールの添付ファイルから再取得（ GAS ） "


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name ステータス完了 Action - 1


Action name ステータス完了 Action - 1


Bulk action? Yes


Modifies data? Yes

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


With these properties {"Assignments":[{"ColumnToEdit":" ステータ

ス ","NewColumnValue":"=\" 完了 \""}],"ColumnToEdit":" ステータ

ス ","NewColumnValue":"=\" 完了

\"","InputParametersUsed":null,"Prominence":"Display_Prominent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 472/474


2026/01/17 0:58 Application Documentation

ly","NeedsConfirmation":false,"ConfirmationMessage":"","Modifie
sData":true,"BulkApplicable":true}


Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column ステータス


Set this column ステータス


Only if this condition is

true
true


Disable automatic
No
updates?


Action icon 


For a record of this table エラー履歴 T


Does this action apply to

No
the whole table?


To this value =" 完了 "


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent

#### Action name View Ref ( 顧客名 )


Action name View Ref ( 顧客名 )


Bulk action? No


Modifies data? No

Needs confirmation? No


Prominence Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Action order Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent



With these properties



{"NavigateTarget":"CONCATENATE(\"#page=detail&table=%E9%
A1%A7%E5%AE%A2M&row=\", ENCODEURL([ 顧客名 ])
)","Prominence":"Display_Inline","NeedsConfirmation":false,"Conf
irmationMessage":"","ModifiesData":false,"BulkApplicable":false}



Do this Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


Attach to column 顧客名


Set this column 顧客名


Only if this condition is
NOT(ISBLANK([ 顧客名 ]))
true


Disable automatic
No
updates?


Action icon 


For a record of this table 書類管理 T


Does this action apply to

No
the whole table?


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 473/474


2026/01/17 0:58 Application Documentation


Visible? Microsoft.AspNetCore.Mvc.ViewFeatures.StringHtmlContent


https://www.appsheet.com/template/appdoc?appId=7d1e0929-85d7-4683-8e7c-239e80477a5d 474/474


