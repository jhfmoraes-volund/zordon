export default function DashboardLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div
        role="status"
        aria-label="Carregando"
        className="size-10 animate-spin rounded-full border-2 border-primary/15 border-t-primary shadow-[0_0_18px_-2px] shadow-primary/50"
      />
    </div>
  );
}
