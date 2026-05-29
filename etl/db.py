from __future__ import annotations

from contextlib import contextmanager


@contextmanager
def connect_database(database_url: str):
    if not database_url:
        raise ValueError("DATABASE_URL is required for raw imports.")

    try:
        import psycopg
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "psycopg is required for raw imports. Install it with 'pip install psycopg[binary]'."
        ) from exc

    with psycopg.connect(database_url) as connection:
        yield connection
