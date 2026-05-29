from __future__ import annotations


def test_rebuild_curated_cli_uses_repository_factory_and_threshold() -> None:
    from etl.rebuild_curated import run_cli

    captured: dict[str, object] = {}

    class FakeRepository:
        pass

    def fake_repository_factory(database_url: str):
        captured["database_url"] = database_url
        return FakeRepository()

    def fake_runner(repository, review_threshold: float):
        captured["repository"] = repository
        captured["review_threshold"] = review_threshold

    exit_code = run_cli(
        ["--database-url", "postgresql://example", "--review-threshold", "0.7"],
        repository_factory=fake_repository_factory,
        runner=fake_runner,
    )

    assert exit_code == 0
    assert captured["database_url"] == "postgresql://example"
    assert captured["review_threshold"] == 0.7
    assert isinstance(captured["repository"], FakeRepository)
