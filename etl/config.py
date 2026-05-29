from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Runtime configuration for local scripts and Supabase ETL jobs."""

    repo_root: Path
    datasets_dir: Path
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""


def load_settings(repo_root: Path | None = None) -> Settings:
    base_dir = repo_root or Path(__file__).resolve().parents[1]
    return Settings(
        repo_root=base_dir,
        datasets_dir=base_dir / "Datasets",
        supabase_url=os.getenv("SUPABASE_URL", ""),
        supabase_anon_key=os.getenv("SUPABASE_ANON_KEY", ""),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
        database_url=os.getenv("DATABASE_URL", ""),
    )
