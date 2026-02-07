/**
 * TPP Product Nutritional Reference Data
 *
 * Exact nutritional values extracted from official product labels.
 * Used as ground truth for AI nutrition analysis — when a recipe uses
 * a TPP product, we inject these exact values so the AI doesn't guess.
 */

export interface ProductNutrition {
  product_id: string;
  product_name: string;
  aliases: string[];        // Alternative names the AI might encounter
  serving_size_g: number;
  per_serving: {
    energy_kj: number;
    energy_kcal: number;
    protein_g: number;
    total_fat_g: number;
    saturated_fat_g: number;
    carbohydrates_g: number;
    sugars_g: number;
    dietary_fiber_g: number | null;
    sodium_mg: number;
  };
  per_100g: {
    energy_kj: number;
    energy_kcal: number;
    protein_g: number;
    total_fat_g: number;
    saturated_fat_g: number;
    carbohydrates_g: number;
    sugars_g: number;
    dietary_fiber_g: number | null;
    sodium_mg: number;
  };
}

export const TPP_PRODUCTS: ProductNutrition[] = [
  {
    product_id: 'BMS',
    product_name: 'Buttermilk Pancakes',
    aliases: ['buttermilk', 'buttermilk pancake mix', 'TPP buttermilk', 'buttermilk waffle', 'original pancakes'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 566, energy_kcal: 135, protein_g: 10.0, total_fat_g: 0.6,
      saturated_fat_g: 0.2, carbohydrates_g: 21.9, sugars_g: 0.9,
      dietary_fiber_g: null, sodium_mg: 445,
    },
    per_100g: {
      energy_kj: 1415, energy_kcal: 338, protein_g: 25.1, total_fat_g: 1.5,
      saturated_fat_g: 0.4, carbohydrates_g: 54.8, sugars_g: 2.3,
      dietary_fiber_g: null, sodium_mg: 1114,
    },
  },
  {
    product_id: 'CCS',
    product_name: 'Cookies & Cream Pancakes',
    aliases: ['cookies and cream', 'cookies & cream', 'cookies cream pancake', 'cookies cream waffle'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 583, energy_kcal: 139, protein_g: 10.0, total_fat_g: 2.1,
      saturated_fat_g: 0.6, carbohydrates_g: 22.2, sugars_g: 4.5,
      dietary_fiber_g: null, sodium_mg: 453,
    },
    per_100g: {
      energy_kj: 1458, energy_kcal: 348, protein_g: 25.1, total_fat_g: 5.3,
      saturated_fat_g: 1.5, carbohydrates_g: 55.6, sugars_g: 11.3,
      dietary_fiber_g: null, sodium_mg: 1133,
    },
  },
  {
    product_id: 'CHS',
    product_name: 'Chocolate Pancakes',
    aliases: ['chocolate', 'chocolate pancake mix', 'choc pancake', 'chocolate waffle'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 583, energy_kcal: 139, protein_g: 10.0, total_fat_g: 0.8,
      saturated_fat_g: 0.5, carbohydrates_g: 23.0, sugars_g: 4.5,
      dietary_fiber_g: null, sodium_mg: 419,
    },
    per_100g: {
      energy_kj: 1458, energy_kcal: 348, protein_g: 25.1, total_fat_g: 2.1,
      saturated_fat_g: 1.3, carbohydrates_g: 57.5, sugars_g: 11.3,
      dietary_fiber_g: null, sodium_mg: 1048,
    },
  },
  {
    product_id: 'CIS',
    product_name: 'Cinnamon Churro Pancakes',
    aliases: ['cinnamon', 'cinnamon churro', 'churro pancake', 'cinnamon waffle'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 575, energy_kcal: 137, protein_g: 10.5, total_fat_g: 0.6,
      saturated_fat_g: 0.3, carbohydrates_g: 22.7, sugars_g: 5.2,
      dietary_fiber_g: null, sodium_mg: 447,
    },
    per_100g: {
      energy_kj: 1438, energy_kcal: 343, protein_g: 26.3, total_fat_g: 1.6,
      saturated_fat_g: 0.8, carbohydrates_g: 56.8, sugars_g: 13.0,
      dietary_fiber_g: null, sodium_mg: 1118,
    },
  },
  {
    product_id: 'GFBS',
    product_name: 'Gluten Free Buttermilk Pancakes',
    aliases: ['gluten free buttermilk', 'GF buttermilk', 'gluten free pancake'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 566, energy_kcal: 135, protein_g: 10.0, total_fat_g: 0.6,
      saturated_fat_g: 0.2, carbohydrates_g: 21.9, sugars_g: 0.9,
      dietary_fiber_g: 1.7, sodium_mg: 445,
    },
    per_100g: {
      energy_kj: 1415, energy_kcal: 338, protein_g: 25.1, total_fat_g: 1.5,
      saturated_fat_g: 0.4, carbohydrates_g: 54.8, sugars_g: 2.3,
      dietary_fiber_g: 4.3, sodium_mg: 1114,
    },
  },
  {
    product_id: 'GFCIS',
    product_name: 'Gluten Free Cinnamon Churro Pancakes',
    aliases: ['gluten free cinnamon', 'GF cinnamon churro', 'GF churro'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 575, energy_kcal: 137, protein_g: 10.5, total_fat_g: 0.6,
      saturated_fat_g: 0.3, carbohydrates_g: 22.8, sugars_g: 1.1,
      dietary_fiber_g: 1.5, sodium_mg: 448,
    },
    per_100g: {
      energy_kj: 1438, energy_kcal: 343, protein_g: 26.3, total_fat_g: 1.6,
      saturated_fat_g: 0.8, carbohydrates_g: 57.0, sugars_g: 2.8,
      dietary_fiber_g: 3.7, sodium_mg: 1119,
    },
  },
  {
    product_id: 'MAS',
    product_name: 'Maple Pancakes',
    aliases: ['maple', 'maple pancake mix', 'maple waffle'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 575, energy_kcal: 137, protein_g: 10.0, total_fat_g: 0.6,
      saturated_fat_g: 0.3, carbohydrates_g: 23.4, sugars_g: 5.2,
      dietary_fiber_g: null, sodium_mg: 437,
    },
    per_100g: {
      energy_kj: 1438, energy_kcal: 343, protein_g: 25.1, total_fat_g: 1.6,
      saturated_fat_g: 0.8, carbohydrates_g: 58.6, sugars_g: 13.0,
      dietary_fiber_g: null, sodium_mg: 1093,
    },
  },
  {
    product_id: 'SCS',
    product_name: 'Salted Caramel Pancakes',
    aliases: ['salted caramel', 'salted caramel pancake', 'salted caramel waffle'],
    serving_size_g: 40,
    per_serving: {
      energy_kj: 575, energy_kcal: 137, protein_g: 10.5, total_fat_g: 0.5,
      saturated_fat_g: 0.2, carbohydrates_g: 22.5, sugars_g: 5.6,
      dietary_fiber_g: null, sodium_mg: 420,
    },
    per_100g: {
      energy_kj: 1438, energy_kcal: 343, protein_g: 26.3, total_fat_g: 1.3,
      saturated_fat_g: 0.6, carbohydrates_g: 56.3, sugars_g: 14.0,
      dietary_fiber_g: null, sodium_mg: 1050,
    },
  },
  {
    product_id: 'SFMS',
    product_name: 'Sugar Free Maple Flavoured Syrup',
    aliases: ['TPP syrup', 'sugar free syrup', 'maple syrup TPP', 'protein pancake syrup'],
    serving_size_g: 37, // 37ml
    per_serving: {
      energy_kj: 441, energy_kcal: 105, protein_g: 0, total_fat_g: 0,
      saturated_fat_g: 0, carbohydrates_g: 0.5, sugars_g: 0,
      dietary_fiber_g: 0.5, sodium_mg: 7,
    },
    per_100g: {
      energy_kj: 1190, energy_kcal: 284, protein_g: 0, total_fat_g: 0,
      saturated_fat_g: 0, carbohydrates_g: 1.0, sugars_g: 0,
      dietary_fiber_g: 1.0, sodium_mg: 18,
    },
  },
];

/**
 * Format the TPP product reference data as context for AI prompts
 */
export function getTPPReferenceContext(): string {
  return `IMPORTANT — The Protein Pancake (TPP) Official Product Nutritional Data:
These are EXACT lab-tested values from product labels. When a recipe uses any TPP product,
you MUST use these exact values (scaled by the amount used) rather than estimating.

${TPP_PRODUCTS.map(p => `
${p.product_name} (${p.product_id}):
  Serving: ${p.serving_size_g}g
  Per serve: ${p.per_serving.energy_kcal} kcal | Protein ${p.per_serving.protein_g}g | Fat ${p.per_serving.total_fat_g}g (Sat ${p.per_serving.saturated_fat_g}g) | Carbs ${p.per_serving.carbohydrates_g}g (Sugars ${p.per_serving.sugars_g}g) | Fiber ${p.per_serving.dietary_fiber_g ?? '—'}g | Sodium ${p.per_serving.sodium_mg}mg
  Per 100g: ${p.per_100g.energy_kcal} kcal | Protein ${p.per_100g.protein_g}g | Fat ${p.per_100g.total_fat_g}g | Carbs ${p.per_100g.carbohydrates_g}g | Sodium ${p.per_100g.sodium_mg}mg`).join('\n')}

All TPP pancake/waffle mixes: 320g packet, 8 serves of 40g. High-protein (~25g per 100g).
Mix typically requires adding water/milk and cooking.`;
}
