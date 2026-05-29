import '../../lib/i18n';
import { getCaseDdiByIngredients } from '../ddi';

describe('getCaseDdiByIngredients', () => {
  test('calls the DDI rpc and maps the response into CaseDdiResult', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          disclaimer_en: 'Screening aid only; always verify clinically.',
          ingredient_a_id: '5cd930ec-cd2a-59e0-9283-d137cd702d9b',
          ingredient_b_id: '85f17a1f-ce4f-56b1-8e93-da323b8e9767',
          patient_message_en: 'This combination may require monitoring.',
          patient_title_en: 'Use with caution',
          recommended_action: 'monitor_or_adjust',
          severity: 'moderate',
          staff_message_en: 'Monitor closely.',
          staff_title_en: 'Moderate interaction',
        },
      ],
      error: null,
    });

    const inFilter = jest.fn().mockResolvedValue({
      data: [
        {
          canonical_name: 'AMOXICILLIN',
          ingredient_id: '5cd930ec-cd2a-59e0-9283-d137cd702d9b',
        },
        {
          canonical_name: 'WARFARIN SODIUM',
          ingredient_id: '85f17a1f-ce4f-56b1-8e93-da323b8e9767',
        },
      ],
      error: null,
    });
    const select = jest.fn().mockReturnValue({ in: inFilter });

    const client = {
      from: jest.fn().mockImplementation((table: string) => {
        if (table !== 'rx_ingredient_concepts') {
          throw new Error(`Unexpected table ${table}`);
        }
        return { select };
      }),
      rpc,
    } as never;

    const result = await getCaseDdiByIngredients(
      [
        '5cd930ec-cd2a-59e0-9283-d137cd702d9b',
        '85f17a1f-ce4f-56b1-8e93-da323b8e9767',
        'missing-ingredient-id',
      ],
      client,
    );

    expect(rpc).toHaveBeenCalledWith('rx_get_ddi_for_ingredients', {
      ingredient_ids: [
        '5cd930ec-cd2a-59e0-9283-d137cd702d9b',
        '85f17a1f-ce4f-56b1-8e93-da323b8e9767',
      ],
    });
    expect(result.checked_ingredient_count).toBe(2);
    expect(result.unchecked_ingredient_count).toBe(1);
    expect(result.checked_ingredients).toEqual([
      {
        canonical_name: 'AMOXICILLIN',
        ingredient_id: '5cd930ec-cd2a-59e0-9283-d137cd702d9b',
      },
      {
        canonical_name: 'WARFARIN SODIUM',
        ingredient_id: '85f17a1f-ce4f-56b1-8e93-da323b8e9767',
      },
    ]);
    expect(result.interactions_found_count).toBe(1);
    expect(result.interactions[0]?.severity).toBe('moderate');
    expect(result.coverage_disclaimer_en).toContain('Taiwan curated dictionary');
  });
});
