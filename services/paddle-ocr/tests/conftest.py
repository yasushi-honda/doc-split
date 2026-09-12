"""ADR-0025 PR4a: pytest共通設定。

重要な既知の挙動: `TestClient(app)` を `with` 文を使わずに生成した場合、ASGIのlifespanは
実行されない(starlette/fastapiの仕様、実測確認済み)。これにより、テストは
`app_module.ENGINE` にスタブを直接代入するだけで、paddleocr/paddlepaddleを一切importせずに
HTTP層(/health, /ocr)を検証できる。`with TestClient(app) as client:` の形は使わないこと
(lifespanが実行されENGINE構築が走り、paddleocrのimportが発生してしまう)。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
