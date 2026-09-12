import { useEngine } from '../hooks.ts';

export function Toast() {
  const toast = useEngine((s) => s.ui.toast);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast && (
        <div className="toast" data-tone={toast.tone} key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
