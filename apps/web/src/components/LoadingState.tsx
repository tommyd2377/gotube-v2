export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loadingState" role="status" aria-live="polite">
      <img className="loadingLogo goTubePulse" src="/brand/gotube-mark-blue-transparent.svg" alt="" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
