from __future__ import annotations

import argparse
from contextlib import nullcontext
from pathlib import Path
from typing import Callable

from .config import load_settings
from .curated_repository import CuratedRepository
from .db import connect_database
from .qc_report import build_qc_report, write_qc_outputs


def _default_repository_factory(database_url: str):
    connection_context = connect_database(database_url)

    class RepositoryContext:
        def __enter__(self):
            self.connection = connection_context.__enter__()
            return CuratedRepository(self.connection)

        def __exit__(self, exc_type, exc, tb):
            return connection_context.__exit__(exc_type, exc, tb)

    return RepositoryContext()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate QC outputs for Taiwan RxNorm raw and curated data.")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Postgres connection string. Falls back to DATABASE_URL.",
    )
    parser.add_argument(
        "--output-dir",
        default="outputs/qc",
        help="Directory for generated Markdown and CSV QC outputs.",
    )
    parser.add_argument(
        "--mismatch-limit",
        type=int,
        default=10,
        help="Maximum number of TFDA mismatch examples to export.",
    )
    return parser


def run_cli(
    argv: list[str] | None = None,
    *,
    repository_factory: Callable[[str], object] | None = None,
    report_builder: Callable[..., dict] = build_qc_report,
    output_writer: Callable[..., dict] = write_qc_outputs,
) -> int:
    args = build_parser().parse_args(argv)
    settings = load_settings()
    database_url = args.database_url or settings.database_url
    if not database_url:
        raise ValueError("Provide --database-url or set DATABASE_URL before generating QC outputs.")

    factory = repository_factory or _default_repository_factory
    repository_or_context = factory(database_url)
    manager = repository_or_context if hasattr(repository_or_context, "__enter__") else nullcontext(repository_or_context)

    with manager as repository:
        dataset = repository.fetch_qc_inputs()
        report = report_builder(dataset, mismatch_limit=args.mismatch_limit)
        output_writer(report, output_dir=Path(args.output_dir))

    return 0


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
