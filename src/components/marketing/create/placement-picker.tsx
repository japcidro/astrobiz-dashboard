"use client";

const PLACEMENTS = {
  facebook: {
    label: "Facebook",
    positions: [
      { key: "feed", label: "Feed" },
      { key: "story", label: "Stories" },
      { key: "marketplace", label: "Marketplace" },
      { key: "video_feeds", label: "Video Feeds" },
      { key: "right_hand_column", label: "Right Column" },
      { key: "search", label: "Search Results" },
    ],
  },
  instagram: {
    label: "Instagram",
    positions: [
      { key: "stream", label: "Feed" },
      { key: "story", label: "Stories" },
      { key: "explore", label: "Explore" },
      { key: "reels", label: "Reels" },
    ],
  },
  audience_network: {
    label: "Audience Network",
    positions: [
      { key: "classic", label: "Native, Banner & Interstitial" },
      { key: "rewarded_video", label: "Rewarded Video" },
    ],
  },
  messenger: {
    label: "Messenger",
    positions: [
      { key: "messenger_home", label: "Inbox" },
      { key: "story", label: "Stories" },
    ],
  },
};

interface PlacementPickerProps {
  automatic: boolean;
  platforms: string[];
  facebookPositions: string[];
  instagramPositions: string[];
  onToggleAutomatic: () => void;
  onUpdate: (updates: {
    platforms?: string[];
    facebookPositions?: string[];
    instagramPositions?: string[];
  }) => void;
}

export function PlacementPicker({
  automatic,
  platforms,
  facebookPositions,
  instagramPositions,
  onToggleAutomatic,
  onUpdate,
}: PlacementPickerProps) {
  const togglePlatform = (platform: string) => {
    const next = platforms.includes(platform)
      ? platforms.filter((p) => p !== platform)
      : [...platforms, platform];
    onUpdate({ platforms: next });
  };

  const togglePosition = (
    platform: "facebook" | "instagram",
    position: string
  ) => {
    if (platform === "facebook") {
      const next = facebookPositions.includes(position)
        ? facebookPositions.filter((p) => p !== position)
        : [...facebookPositions, position];
      onUpdate({ facebookPositions: next });
    } else {
      const next = instagramPositions.includes(position)
        ? instagramPositions.filter((p) => p !== position)
        : [...instagramPositions, position];
      onUpdate({ instagramPositions: next });
    }
  };

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-2">Placements</label>

      {/* Automatic toggle */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onToggleAutomatic}
          className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer"
          style={{
            backgroundColor: automatic
              ? "rgb(34 197 94 / 0.6)"
              : "rgb(75 85 99 / 0.6)",
          }}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              automatic ? "translate-x-[18px]" : "translate-x-[3px]"
            }`}
          />
        </button>
        <div>
          <span className="text-sm text-white font-medium">
            Advantage+ Placements
          </span>
          <p className="text-xs text-gray-500">
            Let Facebook optimize where your ads appear
          </p>
        </div>
      </div>

      {/* Manual placements */}
      {!automatic && (
        <div className="space-y-4 bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
          {Object.entries(PLACEMENTS).map(([platform, config]) => {
            const isEnabled = platforms.includes(platform);
            return (
              <div key={platform}>
                <label className="flex items-center gap-2 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => togglePlatform(platform)}
                    className="rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-white">
                    {config.label}
                  </span>
                </label>
                {isEnabled &&
                  (platform === "facebook" || platform === "instagram") && (
                    <div className="ml-6 flex flex-wrap gap-2">
                      {config.positions.map((pos) => {
                        const positions =
                          platform === "facebook"
                            ? facebookPositions
                            : instagramPositions;
                        const isChecked = positions.includes(pos.key);
                        return (
                          <label
                            key={pos.key}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                              isChecked
                                ? "bg-white/10 text-white"
                                : "bg-gray-700/50 text-gray-500 hover:text-gray-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() =>
                                togglePosition(
                                  platform as "facebook" | "instagram",
                                  pos.key
                                )
                              }
                              className="sr-only"
                            />
                            {pos.label}
                          </label>
                        );
                      })}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
