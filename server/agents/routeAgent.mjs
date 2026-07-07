import { getRoute } from '../routing.mjs';
import { listComplaints } from '../db.mjs';
import { detectHotspots } from '../analytics.mjs';
import { generateNvidiaContent, NVIDIA_CHAT_MODEL } from '../nvidia.mjs';

function getDistance(lat1, lon1, lat2, lon2) {
  const p = 0.017453292519943295;
  const c = Math.cos;
  const a = 0.5 - c((lat2 - lat1) * p)/2 + 
          c(lat1 * p) * c(lat2 * p) * 
          (1 - c((lon2 - lon1) * p))/2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function evaluateRoute(route, complaints, topWards) {
  const flagged = [];
  let riskScore = 'green';
  let severitySum = 0;
  
  for (const c of complaints) {
    if (c.status === 'resolved') continue;
    let minD = Infinity;
    for (const [lng, lat] of route.points) {
      const d = getDistance(lat, lng, c.lat, c.lng);
      if (d < minD) minD = d;
    }
    
    if (minD <= 0.25) {
      flagged.push(c);
      if (c.severity >= 4) {
        severitySum += c.severity;
      }
      if (['Waterlogging', 'Road Damage'].includes(c.category)) {
        severitySum += 5;
      }
    }
  }

  let hotspotCrosses = 0;
  for (const c of flagged) {
    if (topWards.includes(c.ward)) hotspotCrosses++;
  }

  if (severitySum > 10 || hotspotCrosses > 3) riskScore = 'red';
  else if (severitySum > 0 || hotspotCrosses > 0) riskScore = 'amber';

  return { flagged, riskScore, severitySum };
}

export async function runRouteAdvisor(originLat, originLng, destLat, destLng) {
  let routingData;
  try {
    routingData = await getRoute(originLng, originLat, destLng, destLat);
  } catch (e) {
    routingData = {
      routes: [{ points: [[originLng, originLat], [destLng, destLat]], distance: 0, duration: 0 }]
    };
  }

  const complaints = listComplaints();
  const hotspots = detectHotspots(complaints, 30);
  const topWards = hotspots.slice(0, 5).map(h => h.ward);

  const evaluations = routingData.routes.map(r => evaluateRoute(r, complaints, topWards));
  const mainEval = evaluations[0];
  
  let advisory = 'Route looks clear.';
  let altIndex = undefined;

  if (mainEval.riskScore !== 'green') {
    let bestScore = mainEval.severitySum;
    for (let i = 1; i < evaluations.length; i++) {
      if (evaluations[i].severitySum < bestScore) {
        bestScore = evaluations[i].severitySum;
        altIndex = i;
      }
    }

    const context = `Route crosses ${mainEval.flagged.length} open issues. Risk: ${mainEval.riskScore}.
Flagged categories: ${Array.from(new Set(mainEval.flagged.map(c => c.category))).join(', ')}.
Alternatives available: ${altIndex !== undefined ? 'Yes (cleaner alternative found)' : 'No'}.`;

    try {
      const data = await generateNvidiaContent({
        model: NVIDIA_CHAT_MODEL,
        messages: [{
          role: 'user',
          content: `You are an AI route advisor for a city planner.
Context:
${context}

Write a 1-2 sentence plain-language advisory summarizing the hazards. If an alternative is available, advise taking it.`
        }],
        max_tokens: 100,
        temperature: 0.2,
      });
      if (data.choices?.[0]?.message?.content) {
        advisory = data.choices[0].message.content.trim();
      }
    } catch (e) {
      advisory = `High risk route due to ${mainEval.flagged.length} issues. ${altIndex !== undefined ? 'Alternative route recommended.' : 'Proceed with caution.'}`;
    }
  }

  return {
    route: routingData.routes[0],
    riskScore: mainEval.riskScore,
    flaggedComplaints: mainEval.flagged,
    advisory,
    alternativeRouteIndex: altIndex,
    alternativeRoutes: routingData.routes
  };
}
