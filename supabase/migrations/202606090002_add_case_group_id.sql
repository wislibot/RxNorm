alter table public.rx_cases
add column if not exists case_group_id text default null;

create index if not exists idx_rx_cases_case_group_id
    on public.rx_cases (case_group_id);
