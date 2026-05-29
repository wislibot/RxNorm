export type CheckedIngredient = {
  ingredient_id: string;
  canonical_name: string;
};

export type UncheckedItem = {
  reason: 'unknown_product' | 'no_ingredients' | 'missing_ingredient_concept';
  raw_text?: string;
  nhi_code?: string;
};

export type CaseDdiInteraction = {
  ingredient_a_id: string;
  ingredient_b_id: string;
  severity: 'major' | 'moderate' | 'minor';
  patient_title_en: string;
  patient_message_en: string;
  staff_title_en: string;
  staff_message_en: string;
  recommended_action: string;
  disclaimer_en: string;
};

export type CaseDdiResult = {
  checked_ingredient_count: number;
  unchecked_ingredient_count: number;
  checked_ingredients: CheckedIngredient[];
  unchecked_items: UncheckedItem[];
  interactions_found_count: number;
  interactions: CaseDdiInteraction[];
  coverage_disclaimer_en: string;
};

export type CaseDdiRpcRow = {
  ingredient_a_id: string;
  ingredient_b_id: string;
  severity: 'major' | 'moderate' | 'minor';
  patient_title_en: string;
  patient_message_en: string;
  staff_title_en: string;
  staff_message_en: string;
  recommended_action: string;
  disclaimer_en: string;
};
