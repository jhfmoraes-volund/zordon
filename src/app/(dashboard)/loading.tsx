import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      {/* Table skeleton */}
      <div className="surface rounded-lg border">
        {/* Table header */}
        <div className="flex gap-4 border-b px-4 py-3">
          {[140, 100, 80, 120, 60].map((w, i) => (
            <Skeleton key={i} className="h-4" style={{ width: w }} />
          ))}
        </div>

        {/* Table rows */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            {[140, 100, 80, 120, 60].map((w, j) => (
              <Skeleton key={j} className="h-4" style={{ width: w }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
