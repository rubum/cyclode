import React, { useState } from 'react';
import { PlugZap, CheckCircle2, Key, Settings, X, ShieldCheck, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';
import { Integration } from '../../types';

interface IntegrationsViewProps {
  integrations: Integration[];
  activeSkills: string[];
  onRefreshIntegrations?: () => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  integrations,
  activeSkills,
  onRefreshIntegrations,
}) => {
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  const handleOpenConfig = (item: Integration) => {
    setSelectedIntegration(item);
    setTokenInput('');
    setFeedback(null);
  };

  const handleSaveCredential = async () => {
    if (!selectedIntegration || !tokenInput.trim()) return;

    setSubmitting(true);
    setFeedback(null);

    const payload: Record<string, any> = {};
    if (selectedIntegration.id === 'github') {
      payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'slack') {
      payload.token = tokenInput.trim();
    } else if (selectedIntegration.id === 'appsignal') {
      payload.api_key = tokenInput.trim();
    } else if (selectedIntegration.id === 'gemini') {
      payload.api_key = tokenInput.trim();
    } else {
      payload.token = tokenInput.trim();
    }

    try {
      const res = await fetch('http://localhost:8000/api/integrations/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedIntegration.id,
          credentials: payload,
        }),
      });

      const data = await res.json();
      if (data.status === 'configured' || data.validation?.valid) {
        setFeedback({
          success: true,
          message: data.validation?.message || 'Credentials validated and saved successfully.',
        });
        if (onRefreshIntegrations) {
          onRefreshIntegrations();
        }
      } else {
        setFeedback({
          success: false,
          message: data.validation?.message || 'Failed to validate credentials with provider.',
        });
      }
    } catch (err: any) {
      setFeedback({
        success: false,
        message: err.message || 'Error communicating with server.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans text-onedark-fg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-onedark-fgBright flex items-center space-x-2">
            <PlugZap className="w-4 h-4 text-onedark-accent" />
            <span>Integrations & Skills</span>
          </h1>
          <p className="text-xs text-onedark-muted mt-0.5">
            Connected external providers, repository access, and active Antigravity skills.
          </p>
        </div>
      </div>

      {/* Active Skills Banner */}
      <div className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle space-y-2">
        <div className="text-xs font-semibold text-onedark-fgBright flex items-center space-x-1.5">
          <Sparkles className="w-3.5 h-3.5 text-onedark-accent" />
          <span>Mounted Antigravity Skills ({activeSkills.length})</span>
        </div>
        <p className="text-[11px] text-onedark-muted">
          Skills teach the agent API payloads, event schemas, and multi-step tool routines via progressive disclosure.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {activeSkills.map((skill) => (
            <span
              key={skill}
              className="px-2.5 py-1 rounded bg-onedark-surface text-onedark-accent border border-onedark-border text-xs font-mono"
            >
              .agents/skills/{skill}/SKILL.md
            </span>
          ))}
        </div>
      </div>

      {/* Integrations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {integrations.map((item) => (
          <div key={item.id} className="p-4 rounded-xl bg-onedark-darker border border-onedark-borderSubtle space-y-3 shadow-sm hover:border-onedark-border transition-colors">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-onedark-fgBright">{item.name}</h3>
                <div className="text-[11px] text-onedark-muted font-mono mt-0.5">Auth: {item.auth_type}</div>
              </div>

              {item.configured ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-onedark-green/15 text-onedark-green border border-onedark-green/30 flex items-center space-x-1 font-semibold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Configured</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-onedark-surface text-onedark-muted border border-onedark-border flex items-center space-x-1">
                  <Key className="w-3 h-3" />
                  <span>Key Not Set</span>
                </span>
              )}
            </div>

            <p className="text-xs text-onedark-fg leading-relaxed">{item.description}</p>

            <div className="pt-2 border-t border-onedark-borderSubtle flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {item.skills.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-0.5 rounded bg-onedark-bg text-onedark-muted border border-onedark-borderSubtle text-[10px] font-mono"
                  >
                    {s}
                  </span>
                ))}
              </div>

              <button
                onClick={() => handleOpenConfig(item)}
                className="px-2.5 py-1 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fgBright text-xs font-mono flex items-center space-x-1 transition-colors border border-onedark-border"
              >
                <Settings className="w-3 h-3" />
                <span>Configure</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Configuration Modal */}
      {selectedIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="w-full max-w-lg bg-onedark-bg border border-onedark-border rounded-2xl shadow-2xl overflow-hidden animate-scaleIn">
            <div className="p-4 bg-onedark-darker border-b border-onedark-border flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-onedark-accent" />
                <h3 className="text-sm font-semibold text-onedark-fgBright">
                  Configure {selectedIntegration.name}
                </h3>
              </div>
              <button
                onClick={() => setSelectedIntegration(null)}
                className="p-1 rounded-md text-onedark-muted hover:text-onedark-fgBright hover:bg-onedark-surface transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-xs text-onedark-fg leading-relaxed">
                Enter your {selectedIntegration.auth_type}. You can also configure this directly in chat by typing your token or repository URL.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-onedark-muted">
                  {selectedIntegration.id === 'github' ? 'GitHub Personal Access Token (PAT)' :
                   selectedIntegration.id === 'slack' ? 'Slack Bot User OAuth Token' :
                   selectedIntegration.id === 'appsignal' ? 'AppSignal Push API Key' :
                   selectedIntegration.id === 'gemini' ? 'Google AI Studio / Gemini API Key' : 'API Token'}
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder={
                    selectedIntegration.id === 'github' ? 'ghp_xxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'slack' ? 'xoxb-xxxxxxxxxxxxxxxxxxxx' :
                    selectedIntegration.id === 'gemini' ? 'AIzaSyxxxxxxxxxxxxxxxxxxxx' : 'Enter secret key...'
                  }
                  className="w-full px-3 py-2 rounded-xl bg-onedark-darker border border-onedark-border text-sm text-onedark-fgBright font-mono focus:outline-none focus:border-onedark-accent"
                />
              </div>

              {feedback && (
                <div className={`p-3 rounded-xl border text-xs font-mono flex items-start space-x-2 ${
                  feedback.success
                    ? 'bg-onedark-green/10 border-onedark-green/30 text-onedark-green'
                    : 'bg-onedark-red/10 border-onedark-red/30 text-onedark-red'
                }`}>
                  {feedback.success ? (
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  )}
                  <div>{feedback.message}</div>
                </div>
              )}
            </div>

            <div className="p-4 bg-onedark-darker border-t border-onedark-border flex items-center justify-between">
              <span className="text-[11px] font-mono text-onedark-muted">
                Encrypted in runtime memory
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setSelectedIntegration(null)}
                  className="px-3 py-1.5 rounded-lg bg-onedark-surface hover:bg-onedark-border text-onedark-fg text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCredential}
                  disabled={submitting || !tokenInput.trim()}
                  className="px-4 py-1.5 rounded-lg bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker text-xs font-semibold flex items-center space-x-1.5 transition-colors disabled:opacity-40"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save & Validate</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
