-- Add pre-computed OCR keys to rx_drug_products for indexed lookups
-- Eliminates function-call joins in ocr_product_candidates CTE

ALTER TABLE public.rx_drug_products 
  ADD COLUMN IF NOT EXISTS ocr_key_en text 
  GENERATED ALWAYS AS (public.rx_normalize_ocr_spacing(public.rx_strip_dosage_tail(coalesce(name_en, '')))) STORED;

ALTER TABLE public.rx_drug_products 
  ADD COLUMN IF NOT EXISTS ocr_key_zh text 
  GENERATED ALWAYS AS (public.rx_normalize_ocr_spacing(public.rx_strip_dosage_tail(coalesce(name_zh, '')))) STORED;

CREATE INDEX IF NOT EXISTS idx_drug_products_ocr_key_en 
  ON public.rx_drug_products(ocr_key_en) WHERE ocr_key_en IS NOT NULL AND ocr_key_en != '';
CREATE INDEX IF NOT EXISTS idx_drug_products_ocr_key_zh 
  ON public.rx_drug_products(ocr_key_zh) WHERE ocr_key_zh IS NOT NULL AND ocr_key_zh != '';
