import React, { useEffect, useRef } from 'react';

export type TabKey = 'report' | 'ward' | 'admin' | 'track' | 'route' | 'nearme';

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
  const activeRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Task 6 polish: now that overflow is scroll-contained (see the fix note
  // below), the active tab can start scrolled out of view on a narrow screen
  // — e.g. City Admin's role default lands on the LAST tab, which is offscreen
  // to the right until the user notices the scrollbar and swipes. This should
  // bring it into view on mount/tab-change, horizontally only — `Element.
  // scrollIntoView()` was tried first but scrolls whichever axis it judges
  // necessary, and with this header `sticky`, it decided the *page* needed to
  // scroll vertically too, hiding the entire tab bar behind the sticky header
  // (confirmed live). Setting `scrollLeft` directly touches only the
  // horizontal axis of this one container, with no effect on page scroll.
  useEffect(() => {
    const button = activeRef.current;
    const container = scrollContainerRef.current;
    if (!button || !container) return;
    // getBoundingClientRect() (not offsetLeft) deliberately: offsetLeft is
    // relative to whichever ancestor happens to be the nearest *positioned*
    // element, which isn't necessarily this scroll container (none of these
    // elements set `position`) — computing from live rendered rects and
    // adding back the container's current scrollLeft is correct regardless
    // of the offsetParent chain.
    const containerRect = container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const buttonLeft = buttonRect.left - containerRect.left + container.scrollLeft;
    const buttonRight = buttonLeft + buttonRect.width;
    if (buttonLeft < container.scrollLeft) {
      container.scrollLeft = buttonLeft;
    } else if (buttonRight > container.scrollLeft + container.clientWidth) {
      container.scrollLeft = buttonRight - container.clientWidth;
    }
  }, [activeTab]);

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      {/*
        Task 6 fix: with no overflow handling, a role with several tabs (City
        Admin sees all 6) doesn't fit at mobile width — the nav pushed the
        whole page wider than the viewport instead of wrapping or scrolling,
        producing real horizontal page-scroll on a phone (confirmed live:
        document.body.scrollWidth > window.innerWidth at 390px). `overflow-x-auto`
        + `flex-nowrap` + `shrink-0` on each tab contains that scroll inside
        the tab bar itself (swipeable, same pattern as most mobile app tab
        bars) instead of letting it leak into the whole page body.
      */}
      <div ref={scrollContainerRef} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto">
        <nav className="flex flex-nowrap space-x-1 w-max min-w-full" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                ref={isActive ? activeRef : undefined}
                onClick={() => onTabChange(tab.key)}
                className={`
                  px-4 py-4 text-sm font-medium rounded-t-lg transition-all duration-200 whitespace-nowrap shrink-0
                  ${isActive
                    ? 'bg-brand-teal text-white'
                    : 'text-gray-600 hover:text-brand-teal hover:bg-gray-50'
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
