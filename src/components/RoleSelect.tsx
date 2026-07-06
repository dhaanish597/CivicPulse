import React, { useState } from 'react';
import { Building2, ClipboardList, UserRound } from 'lucide-react';
import { RoleSession, UserRole } from '../context/RoleContext';
import { hyderabadLocalities } from '../data/hyderabadLocalities';

interface RoleSelectProps {
  onSelect: (session: RoleSession) => void;
}

export const RoleSelect: React.FC<RoleSelectProps> = ({ onSelect }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('citizen');
  const [name, setName] = useState('');
  const [ward, setWard] = useState(8);

  const selectedLocality = hyderabadLocalities.find((item) => item.ward === ward);
  const canContinue = name.trim().length > 0;

  const handleContinue = () => {
    if (!canContinue) return;

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
          <div className="inline-flex items-center justify-center p-3 bg-[#0E5C56] rounded-xl mb-4">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">CivicPulse</h1>
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
            description="View a ward-scoped dispatch dashboard."
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

          {selectedRole === 'officer' && (
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
            </div>
          )}

          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue}
            className={`w-full py-3 rounded-lg font-medium transition-colors ${
              canContinue
                ? 'bg-[#0E5C56] text-white hover:bg-[#0a4a45]'
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
          ? 'border-[#0E5C56] ring-2 ring-teal-100'
          : 'border-gray-100 hover:border-gray-200'
      }`}
    >
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center mb-4 ${
        selected ? 'bg-[#0E5C56] text-white' : 'bg-gray-100 text-gray-500'
      }`}
      >
        {icon}
      </div>
      <div className="font-semibold text-gray-900">{title}</div>
      <p className="text-sm text-gray-500 mt-2">{description}</p>
    </button>
  );
};
