export const categories = [
  'Garbage Overflow',
  'Pothole / Road Damage',
  'Water Leakage',
  'Streetlight Outage',
  'Drainage Blockage',
  'Stray Animal Hazard',
];

export const sources = ['Citizen App', 'Telegram', 'Call Center'];

// Approximate Hyderabad locality centroids for demo mapping, not surveyed boundaries.
export const localities = [
  { ward: 1, locality: 'Kukatpally', lat: 17.4849, lng: 78.4138 },
  { ward: 2, locality: 'Miyapur', lat: 17.4969, lng: 78.3822 },
  { ward: 3, locality: 'Kondapur', lat: 17.4615, lng: 78.3639 },
  { ward: 4, locality: 'Madhapur / Hitec City', lat: 17.4483, lng: 78.3915 },
  { ward: 5, locality: 'Gachibowli', lat: 17.4401, lng: 78.3489 },
  { ward: 6, locality: 'Jubilee Hills', lat: 17.4326, lng: 78.4071 },
  { ward: 7, locality: 'Banjara Hills', lat: 17.4156, lng: 78.4347 },
  { ward: 8, locality: 'Ameerpet', lat: 17.4374, lng: 78.4482 },
  { ward: 9, locality: 'Begumpet', lat: 17.4435, lng: 78.4682 },
  { ward: 10, locality: 'Secunderabad', lat: 17.4399, lng: 78.4983 },
  { ward: 11, locality: 'Tarnaka', lat: 17.4275, lng: 78.5083 },
  { ward: 12, locality: 'Nallakunta', lat: 17.402, lng: 78.4912 },
  { ward: 13, locality: 'Kachiguda', lat: 17.3833, lng: 78.4975 },
  { ward: 14, locality: 'Malakpet', lat: 17.3746, lng: 78.5 },
  { ward: 15, locality: 'Charminar', lat: 17.3616, lng: 78.4747 },
  { ward: 16, locality: 'Mehdipatnam', lat: 17.3948, lng: 78.4389 },
  { ward: 17, locality: 'Attapur', lat: 17.3654, lng: 78.4276 },
  { ward: 18, locality: 'Dilsukhnagar', lat: 17.3687, lng: 78.5247 },
  { ward: 19, locality: 'Uppal', lat: 17.4058, lng: 78.559 },
  { ward: 20, locality: 'LB Nagar', lat: 17.3457, lng: 78.5518 },
];

export function getLocalityByWard(ward) {
  return localities.find((item) => item.ward === Number(ward)) ?? localities[7];
}

export function getLocalityByName(name) {
  const normalized = String(name ?? '').trim().toLowerCase();
  return localities.find((item) => item.locality.toLowerCase() === normalized) ?? null;
}
