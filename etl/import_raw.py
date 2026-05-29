from __future__ import annotations

from contextlib import nullcontext
from pathlib import Path
from typing import Callable

from .config import load_settings
from .db import connect_database
from .raw_import import build_parser, import_dataset, resolve_dataset_keys
from .raw_repository import RawImportRepository


def _default_repository_factory(database_url: str):
    connection_context = connect_database(database_url)

    class RepositoryContext:
        def __enter__(self):
            self.connection = connection_context.__enter__()
            return RawImportRepository(self.connection)

        def __exit__(self, exc_type, exc, tb):
            if exc_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
            return connection_context.__exit__(exc_type, exc, tb)

    return RepositoryContext()


def run_cli(
    argv: list[str] | None = None,
    *,
    repository_factory: Callable[[str], object] | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings()
    database_url = args.database_url or settings.database_url
    if not database_url:
        raise ValueError("Provide --database-url or set DATABASE_URL before running imports.")

    datasets_dir = Path(args.datasets_dir) if args.datasets_dir else settings.datasets_dir
    factory = repository_factory or _default_repository_factory
    repository_or_context = factory(database_url)
    manager = repository_or_context if hasattr(repository_or_context, "__enter__") else nullcontext(repository_or_context)

    with manager as repository:
        for dataset_key in resolve_dataset_keys(args.dataset):
            import_dataset(
                repository,
                dataset_key,
                datasets_dir=datasets_dir,
                source_version=args.source_version,
            )

    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
