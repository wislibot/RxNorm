alter table public.rx_cases
add column if not exists ocr_sections jsonb not null default '{}'::jsonb;
