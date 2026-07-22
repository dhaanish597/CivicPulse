import { generateNvidiaContent, NVIDIA_CHAT_MODEL } from '../nvidia.mjs';
import { detectHotspots } from '../analytics.mjs';
import { listComplaints, updateComplaintStatus, insertStatusEvent } from '../db.mjs';
import { generateId } from '../utils.mjs';
import { hashKey, withCache } from '../cache.mjs';

// Round 2 Task 4, Step 2: bump if the lead-generation prompt below changes shape.
const LEAD_PROMPT_VERSION = 'v1';

export async function runResolution(complaint, status, actor = 'agent', note = null) {
  let lead = complaint.lead;

  if (status === 'in_progress') {
    lead = await generateLead(complaint);
  }

  updateComplaintStatus(complaint.id, { status, lead });
  insertStatusEvent({
    id: generateId('EVT'),
    complaintId: complaint.id,
    status,
    note,
    actor,
  });

  return lead;
}

async function generateLead(complaint) {
  const complaints = listComplaints();
  const wardComplaints = complaints.filter(c => c.ward === complaint.ward && c.category === complaint.category && c.id !== complaint.id && c.status !== 'resolved');
  const nearbySimilar = wardComplaints.filter(c => getDistance(c.lat, c.lng, complaint.lat, complaint.lng) <= 0.2);
  const hotspots = detectHotspots(complaints, 30);
  const isHotspot = hotspots.some(h => h.ward === complaint.ward && h.category === complaint.category);
  const rank = hotspots.findIndex(h => h.ward === complaint.ward) + 1;

  const contextStr = [
    `Complaint: ${complaint.category} (Severity ${complaint.severity})`,
    `Ward: ${complaint.ward} (${complaint.locality})`,
    `Days Open: ${complaint.daysOpen}`,
    `Nearby similar open complaints (within 200m): ${nearbySimilar.length}`,
    `Is active hotspot: ${isHotspot ? `Yes (Citywide Rank #${rank})` : 'No'}`,
  ].join('\\n');

  const prompt = `You are a municipal operations agent generating a prioritized action lead for a ward officer about to start work on a complaint.
Given this fresh context:
${contextStr}

Write one short, actionable sentence (under 30 words) summarizing the priority and grouping for this job.
For example: "3 similar Garbage Overflow reports within 200m in the last 5 days — treat as a cluster, flag to Ward 8 sanitation as a single high-priority route stop rather than three separate pickups."`;

  try {
    // Keyed on the full context string fed into the prompt (ward, category,
    // severity, days open, nearby-similar count, hotspot rank) — identical
    // context (the common case: a judge re-viewing the same complaint within
    // the cache TTL) hits cache with zero NVIDIA calls; any real change in
    // context (new nearby complaints, hotspot status shifting) naturally
    // busts the cache since the key itself changes.
    const cacheKey = hashKey(['lead', LEAD_PROMPT_VERSION, contextStr]);

    const leadText = await withCache(cacheKey, async () => {
      const data = await generateNvidiaContent({
        model: NVIDIA_CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.2,
      });
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) {
        // Never cache an empty result — fall through to the rule-based
        // fallback below on the very next call too, not a cached blank.
        throw new Error('NVIDIA API returned no lead text.');
      }
      return text;
    });

    if (leadText) return leadText;
  } catch (error) {
    console.warn('NVIDIA API failed to generate lead, using fallback.', error.message);
  }

  return generateFallbackLead(complaint, nearbySimilar.length, isHotspot);
}

function generateFallbackLead(complaint, nearbyCount, isHotspot) {
  if (nearbyCount > 0) {
    return `${nearbyCount} similar open ${complaint.category} reports nearby. Investigate as a cluster.`;
  }
  if (isHotspot) {
    return `Part of an active ${complaint.category} hotspot in Ward ${complaint.ward}. High priority for dispatch.`;
  }
  return `Standard priority ${complaint.category} report. Address during next available route.`;
}

function getDistance(lat1, lon1, lat2, lon2) {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 + 
          c(lat1 * p) * c(lat2 * p) * 
          (1 - c((lon2 - lon1) * p))/2;
  return 12742 * Math.asin(Math.sqrt(a));
}
