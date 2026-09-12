"""ADR-0025 PR4a: requirements.txtとrequirements-test.txtの共通パッケージpinが
完全一致することを検証するドリフト防止テスト。"""

from __future__ import annotations

from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent


def _parse_requirements(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "==" not in line:
            continue
        name, version = line.split("==", 1)
        result[name.strip().lower()] = version.strip()
    return result


def test_common_packages_have_identical_pins():
    prod = _parse_requirements(SERVICE_ROOT / "requirements.txt")
    test = _parse_requirements(SERVICE_ROOT / "requirements-test.txt")

    common = set(prod) & set(test)
    assert common, "requirements.txtとrequirements-test.txtに共通パッケージが1つもありません"

    mismatches = [f"{name}: prod={prod[name]} test={test[name]}" for name in sorted(common) if prod[name] != test[name]]
    assert not mismatches, "pinの不一致:\n" + "\n".join(mismatches)


def test_requirements_test_excludes_heavy_paddle_packages():
    test = _parse_requirements(SERVICE_ROOT / "requirements-test.txt")
    for heavy_pkg in ("paddleocr", "paddlepaddle", "paddlex", "opencv-contrib-python"):
        assert heavy_pkg not in test, f"{heavy_pkg}がrequirements-test.txtに含まれています(CI高速化の目的に反する)"
