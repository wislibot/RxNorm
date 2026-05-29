alter table public.rx_cases
add column if not exists detected_items jsonb not null default '[]'::jsonb;
