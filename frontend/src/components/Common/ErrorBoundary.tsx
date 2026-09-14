import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary captured runtime error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center p-6 text-center font-mono select-none bg-onedark-bg text-onedark-fg">
          <div className="p-3 rounded-2xl bg-onedark-red/10 border border-onedark-red/30 text-onedark-red mb-3">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="text-xs font-semibold text-onedark-fgBright">
            {this.props.fallbackTitle || 'Component Error'}
          </div>
          <div className="text-[11px] text-onedark-muted max-w-sm mt-1.5 leading-relaxed break-words">
            {this.state.error?.message || this.props.fallbackMessage || 'An unexpected runtime error occurred while rendering this section.'}
          </div>
          <button
            onClick={this.handleReset}
            className="mt-3.5 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright border border-onedark-border text-xs transition-colors cursor-pointer shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 text-onedark-accent" />
            <span>Reload View</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
