create table if not exists public.rx_ddi_severity_templates (
    severity text primary key,
    patient_title_en text not null,
    patient_title_zh text,
    patient_message_en text not null,
    patient_message_zh text,
    staff_title_en text not null,
    staff_title_zh text,
    staff_message_en text not null,
    staff_message_zh text,
    recommended_action text not null,
    disclaimer text not null,
    updated_at timestamptz not null default timezone('utc', now())
);

insert into public.rx_ddi_severity_templates (
    severity,
    patient_title_en,
    patient_title_zh,
    patient_message_en,
    patient_message_zh,
    staff_title_en,
    staff_title_zh,
    staff_message_en,
    staff_message_zh,
    recommended_action,
    disclaimer
)
values
    (
        'major',
        'High-risk interaction',
        null,
        'These medicines can interact strongly. Talk to your doctor or pharmacist before using them together.',
        null,
        'Major interaction',
        null,
        'Avoid coadministration when possible. If combination therapy is necessary, use specialist review and close monitoring.',
        null,
        'Check for active ingredients, consider alternatives, and monitor closely if coadministration cannot be avoided.',
        'This information supports, but does not replace, clinical judgment and patient-specific review.'
    ),
    (
        'moderate',
        'Use with caution',
        null,
        'These medicines may interact. Ask your doctor or pharmacist whether you need extra monitoring or dose changes.',
        null,
        'Moderate interaction',
        null,
        'Use caution with coadministration and consider monitoring, counseling, or dose adjustment based on the clinical context.',
        null,
        'Review benefits and risks, consider dose adjustment or monitoring, and counsel the patient about interaction symptoms.',
        'This information supports, but does not replace, clinical judgment and patient-specific review.'
    ),
    (
        'minor',
        'Minor interaction',
        null,
        'These medicines have a lower-risk interaction, but you should still mention them to your care team.',
        null,
        'Minor interaction',
        null,
        'Interaction risk is lower, but document the combination and provide routine counseling as appropriate.',
        null,
        'Document the interaction, provide routine counseling, and monitor if clinically indicated.',
        'This information supports, but does not replace, clinical judgment and patient-specific review.'
    )
on conflict (severity) do update
set
    patient_title_en = excluded.patient_title_en,
    patient_title_zh = excluded.patient_title_zh,
    patient_message_en = excluded.patient_message_en,
    patient_message_zh = excluded.patient_message_zh,
    staff_title_en = excluded.staff_title_en,
    staff_title_zh = excluded.staff_title_zh,
    staff_message_en = excluded.staff_message_en,
    staff_message_zh = excluded.staff_message_zh,
    recommended_action = excluded.recommended_action,
    disclaimer = excluded.disclaimer,
    updated_at = timezone('utc', now());

create table if not exists public.rx_ddi_name_map (
    ddinter_drug_name text primary key,
    ddinter_ids text,
    occurrences_in_pairs integer,
    ingredient_id uuid references public.rx_ingredient_concepts(ingredient_id) on delete set null,
    match_method text,
    notes text,
    updated_at timestamptz not null default now()
);

create index if not exists idx_rx_ddi_name_map_ingredient_id
    on public.rx_ddi_name_map (ingredient_id);

create table if not exists public.rx_ddi_pairs (
    ingredient_a_id uuid not null references public.rx_ingredient_concepts(ingredient_id) on delete cascade,
    ingredient_b_id uuid not null references public.rx_ingredient_concepts(ingredient_id) on delete cascade,
    severity text not null references public.rx_ddi_severity_templates(severity) on delete restrict,
    source text not null default 'ddinter',
    source_detail text,
    raw_rows_merged integer,
    created_at timestamptz not null default now(),
    constraint uq_rx_ddi_pairs unique (ingredient_a_id, ingredient_b_id, source),
    constraint ck_rx_ddi_pairs_order check (ingredient_a_id::text < ingredient_b_id::text)
);

create index if not exists idx_rx_ddi_pairs_ingredient_a_id
    on public.rx_ddi_pairs (ingredient_a_id);

create index if not exists idx_rx_ddi_pairs_ingredient_b_id
    on public.rx_ddi_pairs (ingredient_b_id);

create index if not exists idx_rx_ddi_pairs_severity
    on public.rx_ddi_pairs (severity);
