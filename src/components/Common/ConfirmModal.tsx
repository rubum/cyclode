import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  Trash2, 
  ShieldAlert, 
  Info, 
  X, 
  CheckCircle2, 
  AlertCircle,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  requireMatchText?: string;
  matchPlaceholder?: string;
  impactItems?: string[];
  safeItems?: string[];
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  requireMatchText,
  matchPlaceholder,
  impactItems = [],
  safeItems = [],
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  const [matchInput, setMatchInput] = useState('');

  // Reset input when modal opens or closes
  useEffect(() => {
    if (isOpen) {
      setMatchInput('');
    }
  }, [isOpen]);

  // Handle ESC and Enter keydown
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        if (!isLoading && (!requireMatchText || matchInput.trim() === requireMatchText.trim())) {
          onConfirm();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLoading, requireMatchText, matchInput, onConfirm, onCancel]);

  if (!isOpen) return null;

  const isMatchValid = !requireMatchText || matchInput.trim() === requireMatchText.trim();

  const getVariantStyles = () => {
    switch (variant) {
      case 'warning':
        return {
          icon: ShieldAlert,
          iconColor: 'text-onedark-yellow',
          iconBg: 'bg-onedark-yellow/15 border-onedark-yellow/30',
          confirmBtn: 'bg-onedark-yellow hover:bg-onedark-yellow/90 text-onedark-darker font-bold',
          badgeText: 'Warning Notice',
          badgeBorder: 'border-onedark-yellow/30 text-onedark-yellow bg-onedark-yellow/10',
        };
      case 'info':
        return {
          icon: Info,
          iconColor: 'text-onedark-accent',
          iconBg: 'bg-onedark-accent/15 border-onedark-accent/30',
          confirmBtn: 'bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-bold',
          badgeText: 'Action Confirmation',
          badgeBorder: 'border-onedark-accent/30 text-onedark-accent bg-onedark-accent/10',
        };
      case 'danger':
      default:
        return {
          icon: Trash2,
          iconColor: 'text-onedark-red',
          iconBg: 'bg-onedark-red/15 border-onedark-red/30',
          confirmBtn: 'bg-onedark-red hover:bg-onedark-red/90 text-white font-bold',
          badgeText: 'Destructive Action',
          badgeBorder: 'border-onedark-red/30 text-onedark-red bg-onedark-red/10',
        };
    }
  };

  const vStyles = getVariantStyles();
  const IconComponent = vStyles.icon;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={onCancel}
    >
      <div 
        className="w-full max-w-lg bg-onedark-darker border border-onedark-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-slideUp text-onedark-fg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-onedark-darker border-b border-onedark-borderSubtle flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl border ${vStyles.iconBg}`}>
              <IconComponent className={`w-4 h-4 ${vStyles.iconColor}`} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-onedark-fgBright">{title}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${vStyles.badgeBorder}`}>
                  {vStyles.badgeText}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors cursor-pointer"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-onedark-fg leading-relaxed">
            {description}
          </p>

          {/* Impact Checklist (What will be deleted) */}
          {impactItems.length > 0 && (
            <div className="p-3.5 rounded-xl bg-onedark-surface/60 border border-onedark-borderSubtle space-y-2">
              <div className="text-[11px] font-mono text-onedark-muted uppercase tracking-wider font-semibold flex items-center space-x-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-onedark-red" />
                <span>Affected Local Data</span>
              </div>
              <ul className="space-y-1.5 text-xs text-onedark-fg">
                {impactItems.map((item, idx) => (
                  <li key={idx} className="flex items-start space-x-2">
                    <span className="text-onedark-red font-bold select-none">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Safe Checklist (What will NOT be modified remotely) */}
          {safeItems.length > 0 && (
            <div className="p-3.5 rounded-xl bg-onedark-green/5 border border-onedark-green/20 space-y-2">
              <div className="text-[11px] font-mono text-onedark-green uppercase tracking-wider font-semibold flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-onedark-green" />
                <span>Remote Safety Guarantee</span>
              </div>
              <ul className="space-y-1.5 text-xs text-onedark-green/90">
                {safeItems.map((item, idx) => (
                  <li key={idx} className="flex items-start space-x-2 font-mono text-[11.5px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-onedark-green flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Require Match Text Input (e.g. Type "CLEAR ALL") */}
          {requireMatchText && (
            <div className="space-y-2 pt-1 border-t border-onedark-borderSubtle/60">
              <label className="block text-xs font-mono text-onedark-muted">
                To confirm, type <span className="text-onedark-fgBright font-bold underline select-all">{requireMatchText}</span> below:
              </label>
              <input
                type="text"
                autoFocus
                value={matchInput}
                onChange={(e) => setMatchInput(e.target.value)}
                placeholder={matchPlaceholder || `Type "${requireMatchText}" to confirm`}
                className="w-full px-3 py-2 rounded-xl bg-onedark-bg border border-onedark-border text-xs text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent transition-colors"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-onedark-darker border-t border-onedark-borderSubtle flex items-center justify-between">
          <span className="text-[11px] font-mono text-onedark-muted">
            Press <kbd className="px-1.5 py-0.5 rounded bg-onedark-surface text-[10px] text-onedark-fg border border-onedark-border">Esc</kbd> to cancel
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="px-3.5 py-2 rounded-xl bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading || !isMatchValid}
              className={`px-4 py-2 rounded-xl text-xs flex items-center space-x-1.5 transition-all shadow-md active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer ${vStyles.confirmBtn}`}
            >
              {isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{confirmText}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
