-- Add CJK helper functions to avoid MCP regex double-escaping
-- rx_has_cjk: detect if text contains CJK characters
-- rx_extract_cjk: extract only CJK characters from text

CREATE OR REPLACE FUNCTION public.rx_has_cjk(input text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT input SIMILAR TO '%[\u4e00-\u9fff]%'
$function$;

CREATE OR REPLACE FUNCTION public.rx_extract_cjk(input text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT trim(regexp_replace(input, '[^\u4e00-\u9fff]+', ' ', 'g'))
$function$;
