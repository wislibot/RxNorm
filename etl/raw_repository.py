from __future__ import annotations

from collections.abc import Iterable, Sequence

from .utils import build_import_batch_payload


class RawImportRepository:
    """Small repository for recording import batches and loading raw rows."""

    def __init__(self, connection) -> None:
        self.connection = connection

    def start_batch(
        self,
        source_name: str,
        source_version: str | None = None,
        notes: str | None = None,
    ) -> str:
        payload = build_import_batch_payload(
            source_name=source_name,
            row_count=0,
            source_version=source_version,
            notes=notes,
        )
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                insert into public.rx_import_batches (
                    import_batch_id,
                    source_name,
                    source_version,
                    imported_at,
                    row_count,
                    notes
                )
                values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    payload["import_batch_id"],
                    payload["source_name"],
                    payload["source_version"],
                    payload["imported_at"],
                    payload["row_count"],
                    payload["notes"],
                ),
            )
        return str(payload["import_batch_id"])

    def insert_rows(
        self,
        table_name: str,
        columns: Sequence[str],
        rows: Iterable[dict[str, object]],
        import_batch_id: str,
        *,
        start_row_number: int = 1,
        batch_size: int = 500,
    ) -> int:
        prefixed_columns = ("import_batch_id", "row_number", *columns)
        placeholders = ", ".join(["%s"] * len(prefixed_columns))
        sql = (
            f"insert into public.{table_name} "
            f"({', '.join(prefixed_columns)}) "
            f"values ({placeholders})"
        )

        inserted = 0
        row_number = start_row_number
        pending: list[tuple[object, ...]] = []
        with self.connection.cursor() as cursor:
            for row in rows:
                pending.append(
                    (
                        import_batch_id,
                        row_number,
                        *[row.get(column) for column in columns],
                    )
                )
                row_number += 1
                if len(pending) >= batch_size:
                    cursor.executemany(sql, pending)
                    inserted += len(pending)
                    pending.clear()

            if pending:
                cursor.executemany(sql, pending)
                inserted += len(pending)

        return inserted

    def replace_simple_rows(
        self,
        table_name: str,
        columns: Sequence[str],
        rows: Iterable[dict[str, object]],
    ) -> int:
        row_list = list(rows)
        with self.connection.cursor() as cursor:
            cursor.execute(f"delete from public.{table_name}")
            if not row_list:
                return 0

            placeholders = ", ".join(["%s"] * len(columns))
            sql = (
                f"insert into public.{table_name} "
                f"({', '.join(columns)}) "
                f"values ({placeholders})"
            )
            cursor.executemany(sql, [tuple(row.get(column) for column in columns) for row in row_list])
        return len(row_list)

    def complete_batch(self, import_batch_id: str, row_count: int) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                update public.rx_import_batches
                set row_count = %s
                where import_batch_id = %s
                """,
                (row_count, import_batch_id),
            )
