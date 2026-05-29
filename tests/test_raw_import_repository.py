from __future__ import annotations


class FakeCursor:
    def __init__(self) -> None:
        self.execute_calls: list[tuple[str, object]] = []
        self.executemany_calls: list[tuple[str, list[tuple[object, ...]]]] = []

    def execute(self, sql: str, params: object = None) -> None:
        self.execute_calls.append((sql, params))

    def executemany(self, sql: str, params_seq: list[tuple[object, ...]]) -> None:
        self.executemany_calls.append((sql, list(params_seq)))

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class FakeConnection:
    def __init__(self) -> None:
        self.cursor_obj = FakeCursor()

    def cursor(self) -> FakeCursor:
        return self.cursor_obj


def test_raw_import_repository_records_batch_and_row_inserts() -> None:
    from etl.raw_repository import RawImportRepository

    connection = FakeConnection()
    repository = RawImportRepository(connection)

    batch_id = repository.start_batch(source_name="nhi_items", source_version="2026-05", notes="import")
    row_count = repository.insert_rows(
        table_name="raw_nhi_items",
        columns=("nhi_code", "name_en"),
        rows=[{"nhi_code": "A0001", "name_en": "TEST"}],
        import_batch_id=batch_id,
    )
    repository.complete_batch(batch_id, row_count)

    assert batch_id
    assert row_count == 1
    assert "insert into public.rx_import_batches" in connection.cursor_obj.execute_calls[0][0].lower()
    sql, params = connection.cursor_obj.executemany_calls[0]
    assert "insert into public.raw_nhi_items" in sql.lower()
    assert params == [(batch_id, 1, "A0001", "TEST")]
    assert "update public.rx_import_batches" in connection.cursor_obj.execute_calls[-1][0].lower()
