import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, Polyline } from 'react-leaflet';
import { Complaint } from '../types';
import { categoryColors } from '../data/categoryColors';
import { hyderabadLocalities } from '../data/hyderabadLocalities';

interface MapViewProps {
  complaints: Complaint[];
  height?: string;
  zoom?: number;
  scopedWard?: number;
  route?: { points: [number, number][] };
  routeColor?: string;
  centerLocation?: { lat: number; lng: number };
  radiusKm?: number;
}

const HYDERABAD_CENTER: [number, number] = [17.385, 78.4867];
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function MapView(props: MapViewProps) {
  const { complaints, height = '360px', zoom = 11, scopedWard } = props;
  const openComplaints = complaints.filter((complaint) => !complaint.resolved);
  const maxWardCount = Math.max(1, ...hyderabadLocalities.map((locality) => countRecentWardComplaints(complaints, locality.ward)));
  const center = props.centerLocation 
    ? props.centerLocation 
    : scopedWard
      ? hyderabadLocalities.find((locality) => locality.ward === scopedWard)
      : null;

  const defaultZoom = props.radiusKm ? 14 : zoom;

  return (
    <MapContainer
      center={center ? [center.lat, center.lng] : HYDERABAD_CENTER}
      zoom={scopedWard ? Math.max(defaultZoom, 13) : defaultZoom}
      scrollWheelZoom={false}
      className="z-0"
      style={{ height, width: '100%' }}
    >
      <TileLayer attribution={OSM_ATTRIBUTION} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {props.centerLocation && props.radiusKm && (
        <Circle
          center={[props.centerLocation.lat, props.centerLocation.lng]}
          radius={props.radiusKm * 1000}
          pathOptions={{
            color: '#0E5C56',
            fillColor: '#0E5C56',
            fillOpacity: 0.05,
            opacity: 0.3,
            weight: 2,
            dashArray: '4 4'
          }}
        />
      )}

      {props.route && (
        <Polyline 
          positions={props.route.points.map(p => [p[1], p[0]])} 
          pathOptions={{ color: props.routeColor || '#3388ff', weight: 5, opacity: 0.8 }}
        />
      )}

      {hyderabadLocalities
        .filter((locality) => !scopedWard || locality.ward === scopedWard)
        .map((locality) => {
          const count = countRecentWardComplaints(complaints, locality.ward);
          if (count === 0) return null;

          const intensity = count / maxWardCount;
          return (
            <Circle
              key={locality.ward}
              center={[locality.lat, locality.lng]}
              radius={350 + intensity * 1700}
              pathOptions={{
                color: '#E85D4C',
                fillColor: '#E85D4C',
                fillOpacity: 0.08 + intensity * 0.22,
                opacity: 0.25 + intensity * 0.35,
                weight: 1,
              }}
            />
          );
        })}

      {openComplaints.map((complaint) => (
        <Marker
          key={complaint.id}
          position={[complaint.lat, complaint.lng]}
          icon={createComplaintIcon(complaint)}
        >
          <Popup>
            <div className="space-y-1 text-sm">
              <div className="font-semibold text-brand-navy">{complaint.category}</div>
              <div>Severity: {complaint.severity}/5</div>
              <div>Open for {complaint.daysOpen} day{complaint.daysOpen === 1 ? '' : 's'}</div>
              <div>{complaint.locality}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

function createComplaintIcon(complaint: Complaint) {
  const size = 12 + complaint.severity * 4;
  const color = categoryColors[complaint.category] ?? '#0E5C56';

  return L.divIcon({
    className: `complaint-marker severity-${complaint.severity}`,
    html: `<span style="width:${size}px;height:${size}px;background:${color};"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function countRecentWardComplaints(complaints: Complaint[], ward: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  return complaints.filter((complaint) => complaint.ward === ward && complaint.reportedAt >= cutoff).length;
}
