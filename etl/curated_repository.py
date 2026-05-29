from __future__ import annotations

from contextlib import contextmanager
from typing import Any


class CuratedRepository:
    """Repository for raw reads and curated transactional release writes."""

    def __init__(self, connection) -> None:
        self.connection = connection

    def fetch_raw_inputs(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "raw_nhi_items": self._fetch_all("select * from public.raw_nhi_items"),
            "raw_tfda_permits_active": self._fetch_all("select * from public.raw_tfda_permits_active"),
            "raw_tfda_permits_all": self._fetch_all("select * from public.raw_tfda_permits_all"),
            "raw_atc_ddd": self._fetch_all("select * from public.raw_atc_ddd"),
        }

    def fetch_existing_review_queue_items(self) -> list[dict[str, Any]]:
        return self._fetch_all(
            """
            select
                review_id,
                created_at,
                source,
                nhi_code,
                tfda_permit_no,
                input_text,
                ocr_text,
                candidate_ingredient_ids,
                confidence,
                status,
                review_notes
            from public.rx_review_queue
            """
        )

    def fetch_qc_inputs(self) -> dict[str, list[dict[str, Any]]]:
        return {
            "rx_drug_products": self._fetch_all("select nhi_code, atc_code from public.rx_drug_products"),
            "rx_qc_all1_code_set": self._fetch_all("select nhi_code from public.rx_qc_all1_code_set"),
            "rx_product_ingredients": self._fetch_all("select nhi_code, ingredient_id, source from public.rx_product_ingredients"),
            "rx_nhi_tfda_map": self._fetch_all("select nhi_code, tfda_permit_no from public.rx_nhi_tfda_map"),
            "rx_atc_reference_latest": self._fetch_all("select atc_code, atc_name, snapshot_date from public.rx_atc_reference_latest"),
            "rx_review_queue": self._fetch_all(
                """
                select
                    source,
                    nhi_code,
                    tfda_permit_no,
                    input_text,
                    ocr_text,
                    confidence,
                    status,
                    review_notes
                from public.rx_review_queue
                order by created_at desc
                """
            ),
        }

    @contextmanager
    def transaction(self):
        if hasattr(self.connection, "transaction"):
            with self.connection.transaction():
                yield self
        else:
            yield self

    def clear_curated_tables(self, table_names: list[str]) -> None:
        with self.connection.cursor() as cursor:
            for table_name in table_names:
                cursor.execute(f"delete from public.{table_name}")

    def replace_table(self, table_name: str, columns: tuple[str, ...], rows) -> int:
        row_list = list(rows)
        if not row_list:
            return 0

        placeholders = ", ".join(["%s"] * len(columns))
        sql = (
            f"insert into public.{table_name} "
            f"({', '.join(columns)}) "
            f"values ({placeholders})"
        )
        params = [tuple(row.get(column) for column in columns) for row in row_list]
        with self.connection.cursor() as cursor:
            cursor.executemany(sql, params)
        return len(row_list)

    def append_review_queue_items(self, rows) -> int:
        columns = (
            "review_id",
            "created_at",
            "source",
            "nhi_code",
            "tfda_permit_no",
            "input_text",
            "ocr_text",
            "candidate_ingredient_ids",
            "confidence",
            "status",
            "review_notes",
        )
        return self.replace_table("rx_review_queue", columns, rows)

    def _fetch_all(self, sql: str) -> list[dict[str, Any]]:
        with self.connection.cursor() as cursor:
            cursor.execute(sql)
            rows = cursor.fetchall()
            column_names = [column.name if hasattr(column, "name") else column[0] for column in cursor.description]
        return [dict(zip(column_names, row, strict=False)) for row in rows]
