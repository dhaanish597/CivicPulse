import React from 'react';

export type TabKey = 'report' | 'ward' | 'admin';

export interface Tab {
  key: TabKey;
  label: string;
}

interface TabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  tabs: Tab[];
}

export const TabBar: React.FC<TabBarProps> = ({ activeTab, onTabChange, tabs }) => {
  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`
                  px-4 py-4 text-sm font-medium rounded-t-lg transition-all duration-200
                  ${isActive
                    ? 'bg-[#0E5C56] text-white'
                    : 'text-gray-600 hover:text-[#0E5C56] hover:bg-gray-50'
                  }
                `}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
