import {
  buildDispatchList,
  buildWardSummary,
  computeDailyCounts,
  detectHotspots,
  forecastNext7Days,
  getNearbyIssues,
} from '../analytics.mjs';
import { listComplaints, getComplaintById, listStatusEvents, getDisputedClosures } from '../db.mjs';

export const toolDeclarations = [
  {
    name: 'get_nearby_issues',
    description: 'Find open civic complaints near a latitude/longitude point, sorted nearest first.',
    parameters: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude of the user or point of interest.' },
        lng: { type: 'number', description: 'Longitude of the user or point of interest.' },
        radius_km: { type: 'number', description: 'Search radius in kilometers. Default 2.' },
      },
      required: ['lat', 'lng'],
    },
  },
  {
    name: 'get_ward_summary',
    description: 'Get complaint counts by category and average severity for a ward.',
    parameters: {
      type: 'object',
      properties: {
        ward: { type: 'number', description: 'Ward number from 1 to 20.' },
      },
      required: ['ward'],
    },
  },
  {
    name: 'get_hotspots',
    description: 'Get top citywide 30-day ward/category hotspots.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum hotspots to return. Default 5.' },
      },
    },
  },
  {
    name: 'get_forecast',
    description: 'Get a 7-day complaint forecast for a ward.',
    parameters: {
      type: 'object',
      properties: {
        ward: { type: 'number', description: 'Ward number from 1 to 20.' },
      },
      required: ['ward'],
    },
  },
  {
    name: 'get_dispatch_list',
    description: 'Get urgency-ranked open complaints for dispatch planning.',
    parameters: {
      type: 'object',
      properties: {
        ward: { type: 'number', description: 'Optional ward number from 1 to 20.' },
        limit: { type: 'number', description: 'Maximum complaints to return. Default 5.' },
      },
    },
  },
  {
    name: 'get_report_status',
    description: 'Get the current status, timeline, and AI lead for a specific complaint.',
    parameters: {
      type: 'object',
      properties: {
        complaint_id: { type: 'string', description: 'The CMP-XXXX ID of the complaint.' },
      },
      required: ['complaint_id'],
    },
  },
  {
    name: 'check_route',
    description: 'Check a route between two localities for active complaint hazards and hotspots. Returns an advisory, risk score, and flagged issues.',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin locality name (e.g. Gachibowli) or "my_location"' },
        destination: { type: 'string', description: 'Destination locality name (e.g. Secunderabad)' },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'get_verification_status',
    description: 'Get the resolution-verification status, reasoning, and verified timestamp for a specific complaint.',
    parameters: {
      type: 'object',
      properties: {
        complaint_id: { type: 'string', description: 'The CMP-XXXX ID of the complaint.' },
      },
      required: ['complaint_id'],
    },
  },
  {
    name: 'get_disputed_closures',
    description: 'Get complaints whose officer-claimed resolution was disputed by AI verification (proof photos did not hold up), optionally scoped to a GHMC circle.',
    parameters: {
      type: 'object',
      properties: {
        circle: { type: 'string', description: 'Optional GHMC circle name to scope results.' },
        limit: { type: 'number', description: 'Maximum results to return. Default 10.' },
      },
    },
  },
];

export async function executeTool(name, args = {}) {
  switch (name) {
    case 'get_nearby_issues':
      return getNearbyIssues(
        listComplaints(),
        Number(args.lat),
        Number(args.lng),
        Number(args.radius_km) || 2,
      ).slice(0, 10);

    case 'get_ward_summary':
      return buildWardSummary(listComplaints({ ward: args.ward }), Number(args.ward));

    case 'get_hotspots':
      return detectHotspots(listComplaints(), 30).slice(0, Number(args.limit) || 5);

    case 'get_forecast': {
      const ward = Number(args.ward);
      const complaints = listComplaints({ ward });
      const dailyCounts = computeDailyCounts(complaints.map((complaint) => complaint.reportedAt));
      return {
        ward,
        historicalData: dailyCounts,
        forecast: forecastNext7Days(dailyCounts.map((day) => day.count)),
      };
    }

    case 'get_dispatch_list':
      return buildDispatchList(
        listComplaints(args.ward ? { ward: args.ward } : {}),
        Number(args.limit) || 5,
      );

    case 'get_report_status': {
      const complaint = getComplaintById(args.complaint_id);
      if (!complaint) return { error: `Complaint ${args.complaint_id} not found.` };
      const events = listStatusEvents(args.complaint_id);
      return { 
        id: complaint.id, 
        status: complaint.status, 
        lead: complaint.lead, 
        timeline: events.map(e => ({ status: e.status, actor: e.actor, date: e.createdAt })) 
      };
    }

    case 'check_route': {
      const { runRouteAdvisor } = await import('./routeAgent.mjs');
      const { getLocalityByName } = await import('../data/localities.mjs');
      
      let oLat = args._userLat, oLng = args._userLng;
      if (args.origin && args.origin !== 'my_location') {
        const oLoc = getLocalityByName(args.origin);
        if (oLoc) { oLat = oLoc.lat; oLng = oLoc.lng; }
      }
      if (!oLat || !oLng) return { error: `Could not resolve origin location: ${args.origin}` };

      let dLat, dLng;
      const dLoc = getLocalityByName(args.destination);
      if (dLoc) { dLat = dLoc.lat; dLng = dLoc.lng; }
      if (!dLat || !dLng) return { error: `Could not resolve destination location: ${args.destination}` };

      const result = await runRouteAdvisor(oLat, oLng, dLat, dLng);
      return {
        riskScore: result.riskScore,
        advisory: result.advisory,
        flaggedComplaintsCount: result.flaggedComplaints.length
      };
    }

    case 'get_verification_status': {
      const complaint = getComplaintById(args.complaint_id);
      if (!complaint) return { error: `Complaint ${args.complaint_id} not found.` };
      return {
        verification_status: complaint.verificationStatus,
        verification_reasoning: complaint.verificationReasoning ?? null,
        verified_at: complaint.verifiedAt ?? null,
      };
    }

    case 'get_disputed_closures':
      return getDisputedClosures({ circle: args.circle, limit: Number(args.limit) || 10 });

    default: {
      const error = new Error(`Unknown tool: ${name}`);
      error.status = 400;
      throw error;
    }
  }
}
