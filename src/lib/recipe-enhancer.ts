/**
 * Recipe Enhancer
 * Takes raw recipe text (from a Google Doc or pasted) and uses Claude
 * to transform it into a fully structured, well-written recipe that
 * matches The Protein Pancake's brand voice and format.
 */

// Example recipes that demonstrate the target format and voice
const EXAMPLE_RECIPES = [
  {
    title: '2 Ingredient Pancakes',
    slug: '2-ingredient-pancakes',
    description: 'Fast, fluffy and delicious classic pancakes, topped with fresh fruit and Greek yoghurt. Healthy pancakes should be simple, so these will be ready in 5 minutes.',
    category: 'breakfast',
    tags: ['topping-idea', 'quick', 'high-protein'],
    flavours: ['maple'],
    prep_time_minutes: 1,
    cook_time_minutes: 5,
    servings: 1,
    ingredients: [
      { amount: '1/2', unit: 'cup', item: 'Maple Protein Pancake Mix' },
      { amount: '1/2', unit: 'cup', item: 'milk of choice (almond, soy, dairy) or water' },
      { amount: '2', unit: 'tbsp', item: 'Greek Yoghurt', notes: '≈ 60g, heaped' },
      { amount: '30-40', unit: 'g', item: 'raspberries' },
      { amount: '30-40', unit: 'g', item: 'blueberries' },
    ],
    instructions: [
      'In a bowl, add the pancake mix and milk (or water).',
      'Mix until you get a thick, pourable batter.',
      'Heat a non-stick pan over medium heat and lightly grease it.',
      'Pour batter to form small pancakes. Cook for 2–3 mins per side, or until golden and fluffy.',
      'Stack \'em up with fresh fruit, Greek yogurt and a drizzle of honey or maple syrup.',
    ],
    tips: 'Pro tip: add a bit less milk/water to get your batter extra thick, for super fluffy pancakes.',
    difficulty: 'Easy',
  },
  {
    title: 'Oreo Blondies',
    slug: 'oreo-blondies',
    description: 'Soft, chewy protein blondies studded with Oreo chunks - a healthier take on the classic treat.',
    category: 'baking',
    tags: ['baking', 'dessert', 'oreo'],
    flavours: ['cookies-cream'],
    prep_time_minutes: 10,
    cook_time_minutes: 25,
    servings: 9,
    ingredients: [
      { amount: '1', unit: 'cup', item: 'Protein Pancake Mix' },
      { amount: '1/4', unit: 'cup', item: 'Greek yoghurt' },
      { amount: '2', unit: 'tbsp', item: 'maple syrup' },
      { amount: '1/4', unit: 'cup', item: 'milk' },
      { amount: '6', unit: '', item: 'Oreo cookies, crushed' },
    ],
    instructions: [
      'Preheat oven to 180°C (350°F).',
      'Mix all ingredients except Oreos until smooth.',
      'Fold in crushed Oreos.',
      'Pour into a lined 8x8 baking pan.',
      'Bake for 20-25 minutes until set.',
      'Cool before slicing into 9 squares.',
    ],
    tips: '',
    difficulty: 'Easy',
  },
  {
    title: 'Protein Cinnamon Bun',
    slug: 'protein-cinnamon-bun',
    description: 'A viral recipe with 27.6 grams of protein per bun - all the cinnamon bun flavour without the guilt!',
    category: 'baking',
    tags: ['baking', 'viral', 'cinnamon'],
    flavours: ['cinnamon'],
    prep_time_minutes: 10,
    cook_time_minutes: 20,
    servings: 1,
    ingredients: [
      { amount: '1/2', unit: 'cup', item: 'Protein Pancake Mix' },
      { amount: '3', unit: 'tbsp', item: 'Greek yoghurt' },
      { amount: '2', unit: 'tbsp', item: 'milk' },
      { amount: '1', unit: 'tbsp', item: 'brown sugar' },
      { amount: '1', unit: 'tsp', item: 'cinnamon' },
      { amount: '2', unit: 'tbsp', item: 'cream cheese', notes: 'for icing' },
    ],
    instructions: [
      'Mix pancake mix, yoghurt and milk to form a dough.',
      'Roll out into a rectangle.',
      'Spread with brown sugar and cinnamon.',
      'Roll up tightly and slice or coil.',
      'Bake at 180°C for 15-20 minutes.',
      'Top with cream cheese icing.',
    ],
    tips: '',
    difficulty: 'Easy',
  },
];

export interface EnhancedRecipe {
  title: string;
  slug: string;
  description: string;
  category: string;
  tags: string[];
  flavours: string[];
  prep_time_minutes: number;
  cook_time_minutes: number;
  servings: number;
  ingredients: Array<{ amount: string; unit: string; item: string; notes: string }>;
  instructions: string[];
  tips: string;
  difficulty: string;
}

/**
 * Build the system prompt for Claude to enhance recipes
 */
export function buildEnhancementPrompt(rawRecipeText: string): {
  system: string;
  user: string;
} {
  const examplesJson = JSON.stringify(EXAMPLE_RECIPES, null, 2);

  const system = `You are a recipe editor for The Protein Pancake (TPP), an Australian protein pancake mix brand. Your job is to take rough, shorthand recipe notes and transform them into polished, complete recipes that match the brand's voice and format.

BRAND VOICE:
- Friendly, casual Australian tone
- Short, punchy descriptions (1-2 sentences max)
- Action-oriented instructions ("Mix", "Pour", "Bake")
- Use metric measurements primarily (°C, grams) with imperial in parentheses where helpful
- Mention specific TPP products by name (e.g., "Cookies & Cream Protein Pancake Mix" not just "pancake mix")
- Include helpful tips about texture, substitutions, or variations

TPP PRODUCT NAMES (use exact names):
- Buttermilk Protein Pancake Mix
- Chocolate Protein Pancake Mix
- Cookies & Cream Protein Pancake Mix
- Cinnamon Churro Protein Pancake Mix
- Gluten Free Buttermilk Protein Pancake Mix
- Gluten Free Cinnamon Churro Protein Pancake Mix
- Maple Protein Pancake Mix
- Salted Caramel Protein Pancake Mix

CATEGORIES (pick the most appropriate):
- breakfast, lunch, dinner, snack, dessert, baking

AVAILABLE TAGS (pick 2-4 relevant ones):
- quick, meal-prep, high-protein, kid-friendly, viral, seasonal, baking, dessert, topping-idea, gluten-free, vegetarian, low-carb, waffles

AVAILABLE FLAVOURS (pick any TPP mix flavours used):
- buttermilk, chocolate, cookies-cream, cinnamon, maple, salted-caramel, gluten-free-buttermilk, gluten-free-cinnamon

DIFFICULTY: Easy, Medium, or Hard

HERE ARE EXAMPLE RECIPES showing the exact format and voice to match:
${examplesJson}

FORMATTING RULES:
1. Title: Clear, appetising, 3-8 words
2. Slug: lowercase-hyphenated version of the title
3. Description: 1-2 sentences, compelling, mentions a key benefit (protein, taste, ease)
4. Ingredients: Split into structured {amount, unit, item, notes} objects. Separate the numeric amount from the unit. Use common abbreviations: cup, tbsp, tsp, g, ml, etc.
5. Instructions: 4-8 clear numbered steps. Each step should be 1-2 sentences. Include specific temperatures and times. Be more detailed than the raw notes - explain HOW to do things, not just what to do.
6. Tips: A helpful "Pro tip:" about variations, texture tricks, or substitutions. If the original doesn't have one, create a relevant one.
7. Servings: Infer from the recipe context (donuts = count yield, pancakes = usually 1 serving, sliced items = number of slices)
8. Times: Estimate realistic prep and cook times based on the instructions

CRITICAL: Expand terse instructions into helpful, clear steps. The raw notes are often just reminders - the published recipe needs to guide someone who's never made it before.`;

  const user = `Transform this rough recipe into a polished, complete recipe. Return ONLY a valid JSON object matching the EnhancedRecipe format (no markdown, no explanation).

RAW RECIPE:
${rawRecipeText}

Return a JSON object with these exact fields:
{
  "title": "string",
  "slug": "string",
  "description": "string",
  "category": "string",
  "tags": ["string"],
  "flavours": ["string"],
  "prep_time_minutes": number,
  "cook_time_minutes": number,
  "servings": number,
  "ingredients": [{"amount": "string", "unit": "string", "item": "string", "notes": "string"}],
  "instructions": ["string"],
  "tips": "string",
  "difficulty": "string"
}`;

  return { system, user };
}

/**
 * Parse Claude's response into a structured recipe
 */
export function parseEnhancedRecipe(responseText: string): EnhancedRecipe {
  // Extract JSON from the response (handle potential markdown wrapping)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse recipe JSON from AI response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate required fields
  const required = ['title', 'slug', 'description', 'category', 'ingredients', 'instructions'];
  for (const field of required) {
    if (!parsed[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Ensure ingredients have proper structure
  parsed.ingredients = (parsed.ingredients || []).map((ing: Record<string, string>) => ({
    amount: ing.amount || '',
    unit: ing.unit || '',
    item: ing.item || '',
    notes: ing.notes || '',
  }));

  // Ensure instructions is an array of strings
  if (!Array.isArray(parsed.instructions)) {
    parsed.instructions = [parsed.instructions];
  }

  return {
    title: parsed.title || '',
    slug: parsed.slug || '',
    description: parsed.description || '',
    category: parsed.category || 'breakfast',
    tags: parsed.tags || [],
    flavours: parsed.flavours || [],
    prep_time_minutes: parsed.prep_time_minutes || 5,
    cook_time_minutes: parsed.cook_time_minutes || 10,
    servings: parsed.servings || 1,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
    tips: parsed.tips || '',
    difficulty: parsed.difficulty || 'Easy',
  };
}
