import os
import sys
from pathlib import Path

import psycopg

from etl.config import load_settings
from etl.paths import discover_dataset_paths, require_existing_dataset
from etl.raw_import import DATASET_PLANS
from etl.raw_repository import RawImportRepository


def iter_rows(plan, datasets_dir):
    discovered = discover_dataset_paths(datasets_dir)
    file_paths = []
    for file_name in plan.file_names:
        location = discovered[file_name]
        if not location.exists:
            if plan.optional:
                return
            require_existing_dataset(location.spec, location.path)
        file_paths.append(location.path)

    for file_path in file_paths:
        yield from plan.parser(file_path)


def main() -> int:
    if len(sys.argv) < 2:
        print('usage: tmp_remote_chunked_import.py <dataset_key> [batch_size]')
        return 1

    dataset_key = sys.argv[1]
    batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        raise ValueError('DATABASE_URL is required')

    settings = load_settings()
    datasets_dir = settings.datasets_dir
    plan = DATASET_PLANS[dataset_key]

    with psycopg.connect(database_url) as conn:
        repo = RawImportRepository(conn)
        batch_id = repo.start_batch(
            source_name=plan.source_name,
            source_version=None,
            notes=', '.join(plan.file_names) + ' (chunked remote import)',
        )
        conn.commit()

    prefixed_columns = ('import_batch_id', 'row_number', *plan.columns)
    placeholders = ', '.join(['%s'] * len(prefixed_columns))
    sql = (
        f"insert into public.{plan.table_name} "
        f"({', '.join(prefixed_columns)}) "
        f"values ({placeholders})"
    )

    inserted = 0
    row_number = 1
    pending = []

    for row in iter_rows(plan, datasets_dir):
        pending.append((batch_id, row_number, *[row.get(column) for column in plan.columns]))
        row_number += 1
        if len(pending) >= batch_size:
            with psycopg.connect(database_url) as conn:
                with conn.cursor() as cursor:
                    cursor.executemany(sql, pending)
                conn.commit()
            inserted += len(pending)
            print(f'{dataset_key}: inserted {inserted}', flush=True)
            pending.clear()

    if pending:
        with psycopg.connect(database_url) as conn:
            with conn.cursor() as cursor:
                cursor.executemany(sql, pending)
            conn.commit()
        inserted += len(pending)
        print(f'{dataset_key}: inserted {inserted}', flush=True)

    with psycopg.connect(database_url) as conn:
        repo = RawImportRepository(conn)
        repo.complete_batch(batch_id, inserted)
        conn.commit()

    print(f'{dataset_key}: complete batch_id={batch_id} rows={inserted}', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
