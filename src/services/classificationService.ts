import { Category } from '../types';

export interface ClassificationResult {
  category: Category;
  severity: 1 | 2 | 3 | 4 | 5;
  reasoning?: string;
  fallback?: boolean;
  error?: string;
}

const categoryKeywords: Record<Category, string[]> = {
  'Garbage Overflow': ['garbage', 'trash', 'waste', 'rubbish', 'dump', 'overflow', 'bin', 'dustbin', 'garbage'],
  'Pothole / Road Damage': ['pothole', 'road', 'street', 'damage', 'crack', 'broken', 'hole', 'patch', 'dip'],
  'Water Leakage': ['water', 'leak', 'pipe', 'leakage', 'flooding', 'drain', 'sewage', 'flood', 'wet'],
  'Streetlight Outage': ['light', 'streetlight', 'lamp', 'dark', 'outage', 'power', 'pole', 'electricity', 'glow'],
  'Drainage Blockage': ['drain', 'blocked', 'clog', 'clogged', 'stagnant', 'smell', 'sewer', 'manhole'],
  'Stray Animal Hazard': ['dog', 'animal', 'stray', 'monkey', 'cow', 'pig', 'cat', 'bite', 'attack', 'wild'],
};

const categories = Object.keys(categoryKeywords) as Category[];
const API_TIMEOUT_MS = 20000;

export async function classifyComplaint(
  photoFile: File | null,
  textNote: string
): Promise<ClassificationResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        textNote,
        image: photoFile ? await fileToImagePayload(photoFile) : null,
      }),
    });

    if (!response.ok) {
      const errorText = await readError(response);
      throw new Error(errorText || `Classification failed with status ${response.status}`);
    }

    const data = await response.json();
    const category = data.category as Category;
    const severity = Number(data.severity);

    if (!categories.includes(category) || !isSeverity(severity)) {
      throw new Error('Classification API returned an invalid payload.');
    }

    return {
      category,
      severity,
      reasoning: typeof data.reasoning === 'string' ? data.reasoning : undefined,
    };
  } catch (error) {
    console.warn('NVIDIA API classification failed; using local fallback.', error);
    const fallback = await mockClassifyComplaint(textNote);
    return {
      ...fallback,
      fallback: true,
      error: 'NVIDIA API classification is unavailable. Used the local demo classifier instead.',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function mockClassifyComplaint(
  textNote: string
): Promise<{ category: Category; severity: 1 | 2 | 3 | 4 | 5 }> {
  await new Promise((resolve) => setTimeout(resolve, 800));

  const lowerText = (textNote || '').toLowerCase();

  if (lowerText.length > 0) {
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some((kw) => lowerText.includes(kw))) {
        const severity = determineSeverity(lowerText);
        return { category: category as Category, severity };
      }
    }
  }

  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const randomSeverity = (Math.floor(Math.random() * 5) + 1) as 1 | 2 | 3 | 4 | 5;

  return { category: randomCategory, severity: randomSeverity };
}

function fileToImagePayload(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file.'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const data = result.includes(',') ? result.split(',')[1] : result;
      resolve({ data, mimeType: file.type || 'image/jpeg' });
    };
    reader.readAsDataURL(file);
  });
}

function isSeverity(value: number): value is 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return typeof data.error === 'string' ? data.error : '';
  } catch {
    return response.statusText;
  }
}

function determineSeverity(text: string): 1 | 2 | 3 | 4 | 5 {
  const urgentWords = ['urgent', 'emergency', 'danger', 'critical', 'immediate', 'severe', 'serious', 'hazard'];
  const mildWords = ['minor', 'small', 'slight', 'little', 'annoyance', 'inconvenience'];

  if (urgentWords.some((word) => text.includes(word))) {
    return Math.random() < 0.7 ? 5 : 4;
  }
  if (mildWords.some((word) => text.includes(word))) {
    return Math.random() < 0.7 ? 1 : 2;
  }

  return (Math.floor(Math.random() * 3) + 2) as 2 | 3 | 4;
}
