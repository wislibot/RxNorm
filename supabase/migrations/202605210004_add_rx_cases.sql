create table if not exists public.rx_cases (
    case_id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    case_type text not null check (case_type in ('medicine_bag', 'brand_package')),
    ocr_raw_text text not null default '',
    photo_paths text[] not null default '{}'::text[],
    ingredient_ids uuid[] default null,
    share_to_all_care_teams boolean not null default true
);

create index if not exists idx_rx_cases_user_created_at
    on public.rx_cases (user_id, created_at desc);

create or replace function public.rx_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists trg_rx_cases_set_updated_at on public.rx_cases;
create trigger trg_rx_cases_set_updated_at
before update on public.rx_cases
for each row
execute function public.rx_set_updated_at();

grant select, insert, update, delete on public.rx_cases to authenticated;

alter table public.rx_cases enable row level security;

drop policy if exists rx_cases_insert_own on public.rx_cases;
create policy rx_cases_insert_own
    on public.rx_cases
    for insert
    to authenticated
    with check (auth.uid() = user_id);

drop policy if exists rx_cases_select_own on public.rx_cases;
create policy rx_cases_select_own
    on public.rx_cases
    for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists rx_cases_update_own on public.rx_cases;
create policy rx_cases_update_own
    on public.rx_cases
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists rx_cases_delete_own on public.rx_cases;
create policy rx_cases_delete_own
    on public.rx_cases
    for delete
    to authenticated
    using (auth.uid() = user_id);

grant select on public.rx_ingredient_concepts to authenticated;
grant select on public.rx_ddi_pairs to authenticated;
grant select on public.rx_ddi_severity_templates to authenticated;

drop policy if exists rx_ingredient_concepts_select_authenticated on public.rx_ingredient_concepts;
create policy rx_ingredient_concepts_select_authenticated
    on public.rx_ingredient_concepts
    for select
    to authenticated
    using (true);

drop policy if exists rx_ddi_pairs_select_authenticated on public.rx_ddi_pairs;
create policy rx_ddi_pairs_select_authenticated
    on public.rx_ddi_pairs
    for select
    to authenticated
    using (true);

drop policy if exists rx_ddi_severity_templates_select_authenticated on public.rx_ddi_severity_templates;
create policy rx_ddi_severity_templates_select_authenticated
    on public.rx_ddi_severity_templates
    for select
    to authenticated
    using (true);

create or replace function public.rx_get_ddi_for_ingredients(ingredient_ids uuid[])
returns table (
    ingredient_a_id uuid,
    ingredient_b_id uuid,
    severity text,
    patient_title_en text,
    patient_message_en text,
    staff_title_en text,
    staff_message_en text,
    recommended_action text,
    disclaimer_en text
)
language sql
security invoker
set search_path = public
as $$
    with normalized_input as (
        select distinct ingredient_id
        from unnest(coalesce(ingredient_ids, '{}'::uuid[])) as ingredient_id
        where ingredient_id is not null
    ),
    pairs as (
        select
            least(left_item.ingredient_id::text, right_item.ingredient_id::text)::uuid as ingredient_a_id,
            greatest(left_item.ingredient_id::text, right_item.ingredient_id::text)::uuid as ingredient_b_id
        from normalized_input as left_item
        join normalized_input as right_item
            on left_item.ingredient_id::text < right_item.ingredient_id::text
    )
    select
        ddi.ingredient_a_id,
        ddi.ingredient_b_id,
        ddi.severity,
        template.patient_title_en,
        template.patient_message_en,
        template.staff_title_en,
        template.staff_message_en,
        template.recommended_action,
        template.disclaimer as disclaimer_en
    from pairs
    join public.rx_ddi_pairs as ddi
        on ddi.ingredient_a_id = pairs.ingredient_a_id
       and ddi.ingredient_b_id = pairs.ingredient_b_id
    join public.rx_ddi_severity_templates as template
        on template.severity = ddi.severity
    order by
        case ddi.severity
            when 'major' then 1
            when 'moderate' then 2
            else 3
        end,
        ddi.ingredient_a_id::text,
        ddi.ingredient_b_id::text;
$$;

grant execute on function public.rx_get_ddi_for_ingredients(uuid[]) to authenticated;

insert into storage.buckets (id, name, public)
values ('rx-case-photos', 'rx-case-photos', false)
on conflict (id) do update
set
    name = excluded.name,
    public = excluded.public;

drop policy if exists rx_case_photos_insert_own on storage.objects;
create policy rx_case_photos_insert_own
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'rx-case-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists rx_case_photos_select_own on storage.objects;
create policy rx_case_photos_select_own
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'rx-case-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
