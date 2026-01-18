---
title: "Behavior - アクション・ワークフロー"
description: "30アクション、フォーマットルールの定義"
parent: "書類管理 App 仕様書"
section: "03_behavior"
generated_at: "2026-01-17T01:14:44.199911"
tags:
  - appsheet
  - 書類管理
  - 03_behavior
---

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


