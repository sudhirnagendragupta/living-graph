import React from 'react';
import { useDeskly } from '../store/desklyStore';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useDeskly();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const icons = {
          success: <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />,
          error: <XCircle className="w-5 h-5 text-rose-400 shrink-0" />,
          warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
          info: <Info className="w-5 h-5 text-indigo-400 shrink-0" />,
        };

        const borderStyles = {
          success: 'border-emerald-500/30 bg-zinc-900/95',
          error: 'border-rose-500/30 bg-zinc-900/95',
          warning: 'border-amber-500/30 bg-zinc-900/95',
          info: 'border-indigo-500/30 bg-zinc-900/95',
        };

        return (
          <div
            key={toast.id}
            data-testid="toast-notification"
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-3 duration-200 ${borderStyles[toast.type]}`}
          >
            <div className="mt-0.5">{icons[toast.type]}</div>
            <div className="flex-1 min-w-0">
              {toast.title && (
                <div className="text-xs font-semibold text-zinc-100">{toast.title}</div>
              )}
              <div className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{toast.message}</div>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
              aria-label="Close notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
