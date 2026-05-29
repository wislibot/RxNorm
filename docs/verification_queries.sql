-- Raw table verification
select count(*) as raw_nhi_items_count from public.raw_nhi_items;
select count(*) as raw_tfda_permits_all_count from public.raw_tfda_permits_all;
select count(*) as raw_tfda_permits_active_count from public.raw_tfda_permits_active;
select count(*) as raw_atc_ddd_count from public.raw_atc_ddd;
select count(*) as raw_all1_price_history_count from public.raw_all1_price_history;
select count(*) as raw_nhi_component_map_count from public.raw_nhi_component_map;

-- Curated table verification
select count(*) as rx_drug_products_count from public.rx_drug_products;
select count(*) as rx_ingredient_concepts_count from public.rx_ingredient_concepts;
select count(*) as rx_product_ingredients_count from public.rx_product_ingredients;
select count(*) as rx_name_variants_count from public.rx_name_variants;
select count(*) as rx_tfda_permits_count from public.rx_tfda_permits;
select count(*) as rx_nhi_tfda_map_count from public.rx_nhi_tfda_map;
select count(*) as rx_atc_reference_latest_count from public.rx_atc_reference_latest;
select count(*) as rx_review_queue_count from public.rx_review_queue;

-- Enriched view verification
select * from public.rx_product_enriched_v order by nhi_code limit 20;

-- Review queue and mismatch verification
select * from public.rx_review_queue order by created_at desc limit 20;
select source, status, count(*) as issue_count
from public.rx_review_queue
group by source, status
order by source, status;
