import { Complaint } from '../types';
import { detectHotspots } from './hotspotService';
import { scoreUrgency, computeRecurrenceCounts } from './urgencyService';

export interface ChatAnswerResult {
  answer: string;
  toolsUsed?: string[];
  fallback?: boolean;
  error?: string;
}

const API_TIMEOUT_MS = 20000;

export async function answerQuestion(
  question: string,
  complaints: Complaint[],
  location?: { lat: number; lng: number } | null
): Promise<ChatAnswerResult> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        question,
        lat: location?.lat,
        lng: location?.lng,
      }),
    });

    if (!response.ok) {
      const errorText = await readError(response);
      throw new Error(errorText || `Chat failed with status ${response.status}`);
    }

    const data = await response.json();
    if (typeof data.answer !== 'string' || data.answer.trim().length === 0) {
      throw new Error('Chat API returned an empty answer.');
    }

    return {
      answer: data.answer,
      toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed.map(String) : [],
    };
  } catch (error) {
    console.warn('NVIDIA API chat failed; using local fallback.', error);
    return {
      answer: mockAnswerQuestion(question, complaints),
      fallback: true,
      error: 'NVIDIA API chat is unavailable. Used the local demo assistant instead.',
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return typeof data.error === 'string' ? data.error : '';
  } catch {
    return response.statusText;
  }
}

function mockAnswerQuestion(question: string, complaints: Complaint[]): string {
  const lowerQuestion = question.toLowerCase();

  const wardPatterns = [
    /ward\s*(\d{1,2})/i,
    /ward-?(\d{1,2})/i,
    /ward\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/i,
  ];

  let mentionedWard: number | null = null;

  for (const pattern of wardPatterns) {
    const match = question.match(pattern);
    if (match) {
      if (match[1]) {
        const wordToNum: Record<string, number> = {
          one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
          seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
        };
        mentionedWard = isNaN(parseInt(match[1])) ? wordToNum[match[1].toLowerCase()] || null : parseInt(match[1]);
      }
      break;
    }
  }

  const categories = ['garbage', 'pothole', 'water', 'streetlight', 'drainage', 'animal', 'stray'];
  let mentionedCategory: string | null = null;

  for (const cat of categories) {
    if (lowerQuestion.includes(cat)) {
      mentionedCategory = cat;
      break;
    }
  }

  const hotspots = detectHotspots(complaints, 30);
  const recurrenceMap = computeRecurrenceCounts(complaints);

  if (lowerQuestion.includes('hotspot') || lowerQuestion.includes('most active') || lowerQuestion.includes('worst') || (lowerQuestion.includes('which') && lowerQuestion.includes('ward'))) {
    if (hotspots.length > 0) {
      const top = hotspots[0];
      return `The current hotspot is **Ward ${top.ward} - ${top.category}** with ${top.count} complaints in the last 30 days (avg severity: ${top.avgSeverity}). This location needs immediate attention and resource allocation.`;
    }
    return 'No significant hotspots detected in the last 30 days.';
  }

  if (mentionedWard !== null) {
    const wardComplaints = complaints.filter((c) => c.ward === mentionedWard);
    const openWardComplaints = wardComplaints.filter((c) => !c.resolved);

    if (lowerQuestion.includes('open') || lowerQuestion.includes('unresolved')) {
      return `Ward ${mentionedWard} currently has **${openWardComplaints.length} open complaints** out of ${wardComplaints.length} total reported.`;
    }

    if (mentionedCategory) {
      const categoryComplaints = wardComplaints.filter((c) => c.category.toLowerCase().includes(mentionedCategory!));
      return `Ward ${mentionedWard} has reported **${categoryComplaints.length} ${mentionedCategory}** related complaints overall.`;
    }

    const avgDaysToResolve = wardComplaints
      .filter((c) => c.resolved)
      .reduce((sum, c) => sum + c.daysOpen, 0) / (wardComplaints.filter((c) => c.resolved).length || 1);

    const topIssueInWard = hotspots
      .filter((h) => h.ward === mentionedWard)
      .sort((a, b) => b.count - a.count)[0];

    let response = `**Ward ${mentionedWard} Summary:**\n`;
    response += `- Total complaints: ${wardComplaints.length}\n`;
    response += `- Open issues: ${openWardComplaints.length}\n`;
    response += `- Avg. days to resolve: ${avgDaysToResolve.toFixed(1)} days`;

    if (topIssueInWard) {
      response += `\n- Top recurring issue: ${topIssueInWard.category} (${topIssueInWard.count} cases)`;
    }

    return response;
  }

  if (lowerQuestion.includes('urgent') || lowerQuestion.includes('priority') || lowerQuestion.includes('dispatch')) {
    const openComplaints = complaints.filter((c) => !c.resolved);
    const sortedByUrgency = openComplaints
      .map((c) => ({
        complaint: c,
        urgency: scoreUrgency(c, recurrenceMap.get(`${c.ward}-${c.category}`) || 0),
      }))
      .sort((a, b) => b.urgency - a.urgency);

    const top3 = sortedByUrgency.slice(0, 3);

    if (top3.length === 0) {
      return 'All complaints have been resolved! No urgent items at this time.';
    }

    let response = '**Top 3 Urgent Complaints:**\n';
    top3.forEach((item, idx) => {
      response += `${idx + 1}. Ward ${item.complaint.ward} - ${item.complaint.category} (Urgency: ${item.urgency}, ${item.complaint.daysOpen} days open)\n`;
    });

    return response;
  }

  if (mentionedCategory) {
    const categoryComplaints = complaints.filter((c) => c.category.toLowerCase().includes(mentionedCategory!));
    const openCategoryComplaints = categoryComplaints.filter((c) => !c.resolved);

    const wardBreakdown = new Map<number, number>();
    categoryComplaints.forEach((c) => {
      wardBreakdown.set(c.ward, (wardBreakdown.get(c.ward) || 0) + 1);
    });

    const topWard = Array.from(wardBreakdown.entries()).sort((a, b) => b[1] - a[1])[0];

    let response = `**${mentionedCategory.charAt(0).toUpperCase() + mentionedCategory.slice(1)} Issues:**\n`;
    response += `- Total complaints: ${categoryComplaints.length}\n`;
    response += `- Currently open: ${openCategoryComplaints.length}`;

    if (topWard) {
      response += `\n- Most affected ward: Ward ${topWard[0]} (${topWard[1]} cases)`;
    }

    return response;
  }

  if (lowerQuestion.includes('summary') || lowerQuestion.includes('overview') || lowerQuestion.includes('status')) {
    const openComplaints = complaints.filter((c) => !c.resolved);
    const resolvedComplaints = complaints.filter((c) => c.resolved);
    const avgDaysToResolve = resolvedComplaints.reduce((sum, c) => sum + c.daysOpen, 0) / (resolvedComplaints.length || 1);

    let response = '**City-wide Summary:**\n';
    response += `- Total complaints: ${complaints.length}\n`;
    response += `- Open: ${openComplaints.length} | Resolved: ${resolvedComplaints.length}\n`;
    response += `- Resolution rate: ${((resolvedComplaints.length / complaints.length) * 100).toFixed(1)}%\n`;
    response += `- Avg. days to resolve: ${avgDaysToResolve.toFixed(1)} days`;

    if (hotspots.length > 0) {
      response += `\n- Top hotspot: Ward ${hotspots[0].ward} (${hotspots[0].category})`;
    }

    return response;
  }

  const totalComplaints = complaints.length;
  const openComplaints = complaints.filter((c) => !c.resolved).length;
  const wardsActive = new Set(complaints.map((c) => c.ward)).size;

  return `I have data on **${totalComplaints} complaints** across **${wardsActive} wards** (${openComplaints} currently open). Try asking about a specific ward (e.g., "Tell me about Ward 8"), an issue category (e.g., "garbage issues"), or current hotspots.`;
}
