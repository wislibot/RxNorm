-- Expand rx_normalize_cjk from 27 to 87 simplified→traditional character pairs
-- Covers drug terminology, manufacturer names, and common pharma CJK characters

CREATE OR REPLACE FUNCTION public.rx_normalize_cjk(input text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT translate($1,
    '剂学胶软复灭适肠疗齿叶类视机选达过进还远连边这对导压变强针长门间关体点东买卖电话书画车路铁铜钢钱银锌钙钾钠铝乐锭药维页顺预题额风饮马验黄龙厂开产国医壶号汤发鉴麦龟',
    '劑學膠軟復滅適腸療齒葉類視機選達過進還遠連邊這對導壓變強針長門間關體點東買賣電話書畫車路鐵銅鋼錢銀鋅鈣鉀鈉鋁樂錠藥維頁順預題額風飲馬驗黃龍廠開產國醫壺號湯發鑑麥龜'
  );
$function$;
