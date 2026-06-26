import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getTPPReferenceContext } from '@/lib/nutrition-reference';

export const maxDuration = 60;

interface IngredientInput {
  amount: string;
  unit: string;
  item: string;
  notes?: string;
}

interface NutritionResult {
  calories: number;
  protein: number;
  fat: number;
  saturated_fat: number;
  carbs: number;
  sugars: number;
  fiber: number;
  sodium: number;
}

const REQUIRED_FIELDS: (keyof NutritionResult)[] = [
  'calories', 'protein', 'fat', 'saturated_fat', 'carbs', 'sugars', 'fiber', 'sodium',
];

/**
 * Build the nutrition analysis prompt with TPP reference data.
 */
function buildPrompt(title: string, servings: number, ingredientsList: string): string {
  const tppReference = getTPPReferenceContext();

  return `You are a professional nutritionist and food scientist. Analyze the following recipe and provide accurate nutritional information PER SERVING.

${tppReference}

---

Recipe: ${title || 'Untitled Recipe'}
Servings: ${servings || 1}

Ingredients:
${ingredientsList}

Calculate the nutritional values for ONE SERVING of this recipe.

CRITICAL RULES:
1. If a TPP product is used (any of The Protein Pancake mixes or syrup), use the EXACT nutritional data provided above, scaled by the amount used.
2. For other branded ingredients (protein powders, etc.), use standard database values for similar products.
3. For whole foods (eggs, milk, banana, etc.), use USDA/FSANZ standard reference values.
4. Calculate the total for ALL ingredients combined, THEN divide by ${servings || 1} servings.
5. Account for cooking method (e.g., oil/butter for frying adds fat).
6. Be conservative and precise — do NOT overestimate calories.

Respond with ONLY a JSON object in this exact shape (numbers only, no units, no other text):
{"calories": <kcal whole number>, "protein": <g, 1 decimal>, "fat": <g, 1 decimal>, "saturated_fat": <g, 1 decimal>, "carbs": <g, 1 decimal>, "sugars": <g, 1 decimal>, "fiber": <g, 1 decimal>, "sodium": <mg whole number>}`;
}

/**
 * Parse + validate the nutrition JSON. Accepts the model's raw text (the call prefills the
 * opening "{", so `text` is the continuation — we re-add it before extracting the object).
 */
function parseNutritionJSON(text: string): NutritionResult {
  const candidate = `{${text}`;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('no JSON object in response');

  const parsed = JSON.parse(jsonMatch[0]);
  const result = {} as NutritionResult;
  for (const field of REQUIRED_FIELDS) {
    const n = Number(parsed[field]);
    if (!Number.isFinite(n)) throw new Error(`missing/invalid field: ${field}`);
    result[field] = field === 'calories' || field === 'sodium' ? Math.round(n) : parseFloat(n.toFixed(1));
  }
  return result;
}

/**
 * Single-model nutrition analysis via Claude. Prefilling the assistant turn with "{" forces the
 * model to emit pure JSON (no preamble/markdown), which is what previously broke the parse.
 */
async function analyzeWithClaude(prompt: string): Promise<NutritionResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: '{' }, // prefill → response continues valid JSON
    ],
  });
  const textContent = message.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') throw new Error('no text response from Claude');
  return parseNutritionJSON(textContent.text);
}

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured. Add it to your environment variables.' },
        { status: 500 },
      );
    }

    const { ingredients, servings, title } = await request.json();
    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return NextResponse.json({ error: 'No ingredients provided' }, { status: 400 });
    }

    const ingredientsList = (ingredients as IngredientInput[])
      .filter((i) => i.item.trim())
      .map((i) => `${i.amount} ${i.unit} ${i.item}${i.notes ? ` (${i.notes})` : ''}`)
      .join('\n');

    const prompt = buildPrompt(title, servings, ingredientsList);
    const nutrition = await analyzeWithClaude(prompt);

    return NextResponse.json({ success: true, nutrition, meta: { method: 'claude', confidence: 'medium' } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Nutrition Analysis] Error:', message);
    return NextResponse.json({ error: `Nutrition analysis failed: ${message}` }, { status: 502 });
  }
}
