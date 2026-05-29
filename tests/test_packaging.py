from pathlib import Path


PYPROJECT_PATH = Path("pyproject.toml")


def test_pyproject_explicitly_limits_package_discovery() -> None:
    text = PYPROJECT_PATH.read_text(encoding="utf-8")

    assert "[tool.setuptools]" in text
    assert '[tool.setuptools.packages.find]' in text
    assert 'include = ["etl*"]' in text
