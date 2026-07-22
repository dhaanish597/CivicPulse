import React, { useEffect, useState } from 'react';
import { Building2, ClipboardList, UserRound } from 'lucide-react';
import { RoleSession, UserRole } from '../context/RoleContext';
import { hyderabadLocalities } from '../data/hyderabadLocalities';

interface WardReferenceEntry {
  ward_no: number;
  ward_name: string;
  circle: string | null;
  zone: string | null;
  lat?: number;
  lng?: number;
}

interface WardReferenceResponse {
  wards: WardReferenceEntry[];
  source: 'ghmc_wards.json' | 'fallback-20-locality';
}

interface RoleSelectProps {
  onSelect: (session: RoleSession) => void;
}

export const RoleSelect: React.FC<RoleSelectProps> = ({ onSelect }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('citizen');
  const [name, setName] = useState('');
  const [ward, setWard] = useState(8);
  const [wardReference, setWardReference] = useState<WardReferenceResponse | null>(null);
  const [selectedCircle, setSelectedCircle] = useState('');

  // Ward Officer scoping is real-data-driven: fetch the GHMC circle list so the
  // officer picks their assigned circle (the real operational unit) rather than
  // a made-up ward number. Falls back to the legacy ward picker below if the
  // real reference isn't loaded (ghmc_wards.json absent) or unreachable.
  useEffect(() => {
    let isMounted = true;

    fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5173'}/api/localities`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: WardReferenceResponse | null) => {
        if (!isMounted || !data) return;
        setWardReference(data);
        if (data.source === 'ghmc_wards.json') {
          // Task 6 investigation note (was flagged in HUMAN_CHECKLIST as a
          // "cosmetic mismatch" — default circle isn't alphabetically first
          // like the <select> options below): deliberately left as-is rather
          // than sorted-then-[0]. This "first circle in ghmc_wards.json
          // insertion order" is the exact same rule server/seed.mjs's
          // pickHotspotCircle() uses to choose the one circle it concentrates
          // extra seed volume into for the demo (currently "Kapra") — so this
          // default isn't actually arbitrary, it quietly pre-selects the
          // circle with real, interesting demo data instead of an alphabetically
          // "correct" one that's very likely empty. Switching to sorted-first
          // would trade that convenience for a purely cosmetic consistency
          // win and require re-selecting the right circle by hand every time
          // an Officer session is set up for the demo. Left alone on purpose;
          // if `ghmc_wards.json`'s first entry ever changes, this and
          // seed.mjs's hotspot will move together automatically.
          const firstCircle = [...new Set(data.wards.map((w) => w.circle))].filter(Boolean)[0];
          if (firstCircle) setSelectedCircle(firstCircle);
        }
      })
      .catch(() => {
        // Defensive: keep the legacy ward picker if /api/localities is unreachable.
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const circles = wardReference?.source === 'ghmc_wards.json'
    ? [...new Set(wardReference.wards.map((w) => w.circle).filter((c): c is string => Boolean(c)))].sort()
    : [];

  const selectedLocality = hyderabadLocalities.find((item) => item.ward === ward);
  const canContinue = name.trim().length > 0;

  const handleContinue = () => {
    if (!canContinue) return;

    if (selectedRole === 'officer' && circles.length > 0) {
      onSelect({
        role: selectedRole,
        name: name.trim(),
        circle: selectedCircle,
      });
      return;
    }

    onSelect({
      role: selectedRole,
      name: name.trim(),
      ward: selectedRole === 'officer' ? ward : undefined,
      locality: selectedRole === 'officer' ? selectedLocality?.locality : undefined,
    });
  };

  return (
    <div className="min-h-screen bg-[#FAFBFB] flex items-center justify-center px-4 py-10">
      <div className="max-w-5xl w-full space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center p-3 bg-brand-teal rounded-xl mb-4">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-brand-navy">CivicPulse</h1>
          <p className="text-gray-500 mt-2">Choose a demo role to continue. Data scoping is enforced by backend queries.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RoleCard
            role="citizen"
            title="Citizen"
            description="Report an issue and check nearby open complaints."
            selectedRole={selectedRole}
            onSelect={setSelectedRole}
            icon={<UserRound size={24} />}
          />
          <RoleCard
            role="officer"
            title="Ward Officer"
            description="View a circle-scoped dispatch dashboard."
            selectedRole={selectedRole}
            onSelect={setSelectedRole}
            icon={<ClipboardList size={24} />}
          />
          <RoleCard
            role="admin"
            title="City Admin"
            description="See all wards and citywide operations intelligence."
            selectedRole={selectedRole}
            onSelect={setSelectedRole}
            icon={<Building2 size={24} />}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 max-w-xl mx-auto space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5C56]"
            />
          </div>

          {selectedRole === 'officer' && circles.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700">Assigned Circle</label>
              <select
                value={selectedCircle}
                onChange={(event) => setSelectedCircle(event.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5C56]"
              >
                {circles.map((circle) => (
                  <option key={circle} value={circle}>
                    {circle}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Real GHMC circle — the operational unit headed by a Deputy Commissioner.</p>
            </div>
          )}

          {selectedRole === 'officer' && circles.length === 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700">Assigned Ward</label>
              <select
                value={ward}
                onChange={(event) => setWard(Number(event.target.value))}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0E5C56]"
              >
                {hyderabadLocalities.map((locality) => (
                  <option key={locality.ward} value={locality.ward}>
                    Ward {locality.ward} - {locality.locality}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Real GHMC circle data unavailable — using demo ward list instead.</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className={`w-full py-3 rounded-lg font-medium transition-colors ${
              canContinue
                ? 'bg-brand-teal text-white hover:bg-[#0a4a45]'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

interface RoleCardProps {
  role: UserRole;
  title: string;
  description: string;
  selectedRole: UserRole;
  onSelect: (role: UserRole) => void;
  icon: React.ReactNode;
}

const RoleCard: React.FC<RoleCardProps> = ({
  role,
  title,
  description,
  selectedRole,
  onSelect,
  icon,
}) => {
  const selected = selectedRole === role;

  return (
    <button
      type="button"
      onClick={() => onSelect(role)}
      className={`text-left bg-white rounded-xl border p-5 transition-all ${
        selected
          ? 'border-brand-teal ring-2 ring-teal-100'
          : 'border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center mb-4 ${
        selected ? 'bg-brand-teal text-white' : 'bg-gray-100 text-gray-500'
      }`}
      >
        {icon}
      </div>
      <div className="font-semibold text-brand-navy">{title}</div>
      <p className="text-sm text-gray-500 mt-2">{description}</p>
    </button>
  );
};
