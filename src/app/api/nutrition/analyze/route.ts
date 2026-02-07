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
 * Build the shared nutrition analysis prompt with TPP reference data
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

You MUST respond with ONLY a JSON object in this exact format, no other text:
{
  "calories": <number in kcal, whole number>,
  "protein": <number in grams, 1 decimal>,
  "fat": <number in grams, 1 decimal>,
  "saturated_fat": <number in grams, 1 decimal>,
  "carbs": <number in grams, 1 decimal>,
  "sugars": <number in grams, 1 decimal>,
  "fiber": <number in grams, 1 decimal>,
  "sodium": <number in milligrams, whole number>
}`;
}

/**
 * Parse a JSON nutrition result from model text output
 */
function parseNutritionJSON(text: string): NutritionResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse nutrition JSON from response');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  for (const field of REQUIRED_FIELDS) {
    if (typeof parsed[field] !== 'number') {
      throw new Error(`Missing or invalid field: ${field}`);
    }
  }

  return parsed as NutritionResult;
}

/**
 * Call Claude (Anthropic) for nutrition analysis
 */
async function analyzeWithClaude(prompt: string): Promise<NutritionResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = message.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return parseNutritionJSON(textContent.text);
}

/**
 * Call Gemini (Google) for nutrition analysis
 */
async function analyzeWithGemini(prompt: string): Promise<NutritionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key not configured');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,    // Low temperature for consistency
          maxOutputTokens: 500,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text response from Gemini');
  }

  return parseNutritionJSON(text);
}

/**
 * Cross-validate two nutrition results.
 * Returns a merged result that averages the values, with a confidence score.
 * If only one model succeeded, returns that result.
 */
function crossValidate(
  claudeResult: NutritionResult | null,
  geminiResult: NutritionResult | null,
): { nutrition: NutritionResult; method: string; confidence: string } {
  // If only one model succeeded, return it
  if (!claudeResult && !geminiResult) {
    throw new Error('Both models failed to produce results');
  }
  if (!claudeResult) {
    return { nutrition: geminiResult!, method: 'gemini_only', confidence: 'medium' };
  }
  if (!geminiResult) {
    return { nutrition: claudeResult, method: 'claude_only', confidence: 'medium' };
  }

  // Both models succeeded — cross-validate and average
  const averaged: NutritionResult = {
    calories: 0, protein: 0, fat: 0, saturated_fat: 0,
    carbs: 0, sugars: 0, fiber: 0, sodium: 0,
  };

  let maxDeviation = 0;

  for (const field of REQUIRED_FIELDS) {
    const cVal = claudeResult[field];
    const gVal = geminiResult[field];
    const avg = (cVal + gVal) / 2;

    // Track how far apart they are (as % of average)
    if (avg > 0) {
      const deviation = Math.abs(cVal - gVal) / avg;
      maxDeviation = Math.max(maxDeviation, deviation);
    }

    // Round appropriately
    if (field === 'calories' || field === 'sodium') {
      averaged[field] = Math.round(avg);
    } else {
      averaged[field] = parseFloat(avg.toFixed(1));
    }
  }

  // Confidence based on how close the models agree
  let confidence: string;
  if (maxDeviation < 0.15) {
    confidence = 'high';      // Models agree within 15%
  } else if (maxDeviation < 0.30) {
    confidence = 'medium';    // Models differ 15-30%
  } else {
    confidence = 'low';       // Models differ >30% — review recommended
  }

  return { nutrition: averaged, method: 'dual_model_average', confidence };
}

export async function POST(request: Request) {
  try {
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasGeminiKey = !!process.env.GEMINI_API_KEY;

    if (!hasAnthropicKey && !hasGeminiKey) {
      return NextResponse.json(
        { error: 'No AI API keys configured. Add ANTHROPIC_API_KEY and/or GEMINI_API_KEY to your environment variables.' },
        { status: 500 }
      );
    }

    const { ingredients, servings, title } = await request.json();

    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return NextResponse.json(
        { error: 'No ingredients provided' },
        { status: 400 }
      );
    }

    const ingredientsList = (ingredients as IngredientInput[])
      .filter(i => i.item.trim())
      .map(i => `${i.amount} ${i.unit} ${i.item}${i.notes ? ` (${i.notes})` : ''}`)
      .join('\n');

    const prompt = buildPrompt(title, servings, ingredientsList);

    // Run both models in parallel for speed and cross-validation
    const results = await Promise.allSettled([
      hasAnthropicKey ? analyzeWithClaude(prompt) : Promise.reject(new Error('No Anthropic key')),
      hasGeminiKey ? analyzeWithGemini(prompt) : Promise.reject(new Error('No Gemini key')),
    ]);

    const claudeResult = results[0].status === 'fulfilled' ? results[0].value : null;
    const geminiResult = results[1].status === 'fulfilled' ? results[1].value : null;

    // Capture any individual model failures (non-fatal)
    const claudeError = results[0].status === 'rejected' ? (results[0] as PromiseRejectedResult).reason?.message : null;
    const geminiError = results[1].status === 'rejected' ? (results[1] as PromiseRejectedResult).reason?.message : null;

    if (claudeError && hasAnthropicKey) console.warn('[Nutrition] Claude failed:', claudeError);
    if (geminiError && hasGeminiKey) console.warn('[Nutrition] Gemini failed:', geminiError);

    const { nutrition, method, confidence } = crossValidate(claudeResult, geminiResult);

    return NextResponse.json({
      success: true,
      nutrition,
      meta: {
        method,
        confidence,
        claude: claudeResult ? 'ok' : 'failed',
        gemini: geminiResult ? 'ok' : 'failed',
        ...(claudeError && { claude_error: claudeError }),
        ...(geminiError && { gemini_error: geminiError }),
      },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Nutrition Analysis] Error:', message);
    return NextResponse.json(
      { error: `Nutrition analysis failed: ${message}` },
      { status: 500 }
    );
  }
}
