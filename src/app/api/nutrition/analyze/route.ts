import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to your environment variables.' },
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

    const prompt = `You are a nutritionist. Analyze the following recipe and provide detailed nutritional information PER SERVING.

Recipe: ${title || 'Untitled Recipe'}
Servings: ${servings || 1}

Ingredients:
${ingredientsList}

Calculate the nutritional values for ONE SERVING of this recipe. Consider standard ingredient nutritional databases.

You MUST respond with ONLY a JSON object in this exact format, no other text:
{
  "calories": <number in kcal>,
  "protein": <number in grams, 1 decimal>,
  "fat": <number in grams, 1 decimal>,
  "saturated_fat": <number in grams, 1 decimal>,
  "carbs": <number in grams, 1 decimal>,
  "sugars": <number in grams, 1 decimal>,
  "fiber": <number in grams, 1 decimal>,
  "sodium": <number in milligrams, whole number>
}

Important:
- All values must be for ONE SERVING (total recipe divided by ${servings || 1} servings)
- Use realistic nutritional values based on common ingredient databases
- If an ingredient brand is mentioned (like "TPP" or protein powder), estimate based on typical protein pancake/waffle mix nutritional values (typically high protein ~20-25g per 50g serve)
- Round calories to whole number, macros to 1 decimal, sodium to whole number`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract the text response
    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse the JSON from the response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse nutrition data from response');
    }

    const nutrition: NutritionResult = JSON.parse(jsonMatch[0]);

    // Validate the response has all required fields
    const requiredFields = ['calories', 'protein', 'fat', 'saturated_fat', 'carbs', 'sugars', 'fiber', 'sodium'];
    for (const field of requiredFields) {
      if (typeof (nutrition as unknown as Record<string, unknown>)[field] !== 'number') {
        throw new Error(`Missing or invalid field: ${field}`);
      }
    }

    return NextResponse.json({
      success: true,
      nutrition,
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
