import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildEnhancementPrompt, parseEnhancedRecipe } from '@/lib/recipe-enhancer';

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured. Add it to your environment variables.' },
        { status: 500 }
      );
    }

    const { recipeText } = await request.json();

    if (!recipeText || typeof recipeText !== 'string' || recipeText.trim().length < 10) {
      return NextResponse.json(
        { error: 'Please provide recipe text (at least 10 characters).' },
        { status: 400 }
      );
    }

    const { system, user } = buildEnhancementPrompt(recipeText.trim());

    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    });

    const textContent = message.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const enhanced = parseEnhancedRecipe(textContent.text);

    return NextResponse.json({
      success: true,
      recipe: enhanced,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Recipe Enhance] Error:', message);
    return NextResponse.json(
      { error: `Recipe enhancement failed: ${message}` },
      { status: 500 }
    );
  }
}
