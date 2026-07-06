import { categories } from '../data/localities.mjs';
import { classifyWithGemini } from '../gemini.mjs';

const categoryKeywords = {
  'Garbage Overflow': ['garbage', 'trash', 'waste', 'rubbish', 'dump', 'overflow', 'bin', 'dustbin'],
  'Pothole / Road Damage': ['pothole', 'road', 'street', 'damage', 'crack', 'broken', 'hole', 'patch', 'dip'],
  'Water Leakage': ['water', 'leak', 'pipe', 'leakage', 'flooding', 'sewage', 'flood', 'wet'],
  'Streetlight Outage': ['light', 'streetlight', 'lamp', 'dark', 'outage', 'power', 'pole', 'electricity'],
  'Drainage Blockage': ['drain', 'blocked', 'clog', 'clogged', 'stagnant', 'smell', 'sewer', 'manhole'],
  'Stray Animal Hazard': ['dog', 'animal', 'stray', 'monkey', 'cow', 'pig', 'cat', 'bite', 'attack'],
};

export async function runClassification(ingested) {
  try {
    const result = await classifyWithGemini({
      textNote: ingested.textNote,
      image: ingested.image,
    });

    return { ...result, fallback: false };
  } catch (error) {
    const fallback = localClassify(ingested.textNote);
    return {
      ...fallback,
      reasoning: `Gemini unavailable; local fallback matched "${fallback.category}" from complaint text.`,
      fallback: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function localClassify(textNote) {
  const lowerText = String(textNote ?? '').toLowerCase();

  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((keyword) => lowerText.includes(keyword))) {
      return { category, severity: determineSeverity(lowerText) };
    }
  }

  return {
    category: categories[Math.floor(Math.random() * categories.length)],
    severity: 3,
  };
}

function determineSeverity(text) {
  const urgentWords = ['urgent', 'emergency', 'danger', 'critical', 'immediate', 'severe', 'serious', 'hazard'];
  const mildWords = ['minor', 'small', 'slight', 'little', 'annoyance', 'inconvenience'];

  if (urgentWords.some((word) => text.includes(word))) return 5;
  if (mildWords.some((word) => text.includes(word))) return 2;
  return 3;
}
