export function EmptyState({
  message,
  onRetry,
  retryLabel = "Retry",
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 py-6 text-center"
      role={onRetry === undefined ? "status" : "alert"}
      aria-live={onRetry === undefined ? "polite" : "assertive"}
    >
      <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">{message}</p>
      {onRetry !== undefined ? (
        <button
          type="button"
          className="text-[11px] font-medium text-foreground underline underline-offset-2 hover:text-muted-foreground"
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
