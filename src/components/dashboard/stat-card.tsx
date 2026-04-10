interface Props {
  label: string;
  value: string;
  subtitle?: string;
  subtitleColor?: string;
  icon: React.ReactNode;
  iconBg: string;
  accentBorder?: string;
  loading: boolean;
}

export function StatCard({
  label,
  value,
  subtitle,
  subtitleColor,
  icon,
  iconBg,
  accentBorder,
  loading,
}: Props) {
  return (
    <div
      className={`bg-gray-800/50 border rounded-xl p-4 ${accentBorder || "border-gray-700/50"}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 ${iconBg} rounded-lg`}>{icon}</div>
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      {loading ? (
        <div className="h-7 bg-gray-700/50 rounded animate-pulse" />
      ) : (
        <>
          <p className="text-lg font-bold text-white">{value}</p>
          {subtitle && (
            <p className={`text-xs mt-0.5 ${subtitleColor || "text-gray-500"}`}>
              {subtitle}
            </p>
          )}
        </>
      )}
    </div>
  );
}
