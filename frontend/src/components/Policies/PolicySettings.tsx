import React, { useState, useEffect } from 'react';
import { ShieldCheck, CheckCircle2, Save } from 'lucide-react';
import { PolicyMap } from '../../types';

interface PolicySettingsProps {
  policies: PolicyMap;
  onUpdatePolicies: (newPolicies: PolicyMap) => Promise<any>;
}

export const PolicySettings: React.FC<PolicySettingsProps> = ({ policies, onUpdatePolicies }) => {
  const [localPolicies, setLocalPolicies] = useState<PolicyMap>(policies);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setLocalPolicies(policies);
  }, [policies]);

  const handleChange = (action: string, level: 'auto' | 'require_approval' | 'disabled') => {
    setLocalPolicies((prev) => ({ ...prev, [action]: level }));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdatePolicies(localPolicies);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const actionDescriptions: Record<string, { label: string; desc: string; category: string }> = {
    git_push: {
      label: 'Push Branch to Git Remote',
      desc: 'Allows the agent to push new branches (e.g. adappty/fix-*) to upstream.',
      category: 'Git Operations',
    },
    create_pull_request: {
      label: 'Create GitHub Pull Request',
      desc: 'Allows the agent to open Pull Requests via the GitHub API.',
      category: 'Git Operations',
    },
    post_comment: {
      label: 'Post Issue / PR Comments',
      desc: 'Allows the agent to post progress updates directly onto GitHub issues.',
      category: 'Communication',
    },
    slack_notify: {
      label: 'Post Slack Broadcasts',
      desc: 'Allows the agent to send status alerts to configured Slack channels.',
      category: 'Communication',
    },
    merge_pr: {
      label: 'Merge Pull Requests',
      desc: 'Allows the agent to automatically merge Pull Requests upon test suite success.',
      category: 'Production Ops',
    },
    execute_shell: {
      label: 'Execute Local Shell Commands',
      desc: 'Allows the agent to run test runners (pytest, npm test) and git in the sandbox.',
      category: 'Sandbox Execution',
    },
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans text-onedark-fg">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-onedark-fgBright flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-onedark-accent" />
            <span>Action Approval Policies</span>
          </h1>
          <p className="text-xs text-onedark-muted mt-0.5">
            Configure which actions the Antigravity agent can execute autonomously vs. which require approval.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-3.5 py-1.5 rounded-md bg-onedark-accent hover:bg-onedark-accent/90 text-onedark-darker font-medium text-xs flex items-center space-x-1.5 transition-colors disabled:opacity-50 shadow-sm"
        >
          {saveSuccess ? <CheckCircle2 className="w-3.5 h-3.5 text-onedark-darker" /> : <Save className="w-3.5 h-3.5" />}
          <span>{isSaving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save Changes'}</span>
        </button>
      </div>

      <div className="space-y-3">
        {Object.entries(localPolicies).map(([action, level]) => {
          const info = actionDescriptions[action] || {
            label: action,
            desc: 'Action approval rule',
            category: 'General',
          };

          return (
            <div key={action} className="p-4 rounded-lg bg-onedark-darker border border-onedark-borderSubtle space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-onedark-fgBright">{info.label}</div>
                  <div className="text-[11px] text-onedark-muted mt-0.5">{info.desc}</div>
                </div>

                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-onedark-surface text-onedark-muted border border-onedark-border">
                  {info.category}
                </span>
              </div>

              {/* Selector */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-onedark-borderSubtle text-xs">
                <label
                  className={`p-2.5 rounded border flex items-center space-x-2 cursor-pointer transition-all ${
                    level === 'auto'
                      ? 'bg-onedark-surface border-onedark-green text-onedark-fgBright font-medium'
                      : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
                  }`}
                >
                  <input
                    type="radio"
                    name={`policy_${action}`}
                    checked={level === 'auto'}
                    onChange={() => handleChange(action, 'auto')}
                    className="hidden"
                  />
                  <div>
                    <div className="text-xs font-semibold">Auto-Allow</div>
                    <div className="text-[10px] opacity-75">Autonomous</div>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded border flex items-center space-x-2 cursor-pointer transition-all ${
                    level === 'require_approval'
                      ? 'bg-onedark-surface border-onedark-accent text-onedark-fgBright font-medium'
                      : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
                  }`}
                >
                  <input
                    type="radio"
                    name={`policy_${action}`}
                    checked={level === 'require_approval'}
                    onChange={() => handleChange(action, 'require_approval')}
                    className="hidden"
                  />
                  <div>
                    <div className="text-xs font-semibold">Require Approval</div>
                    <div className="text-[10px] opacity-75">Human review</div>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded border flex items-center space-x-2 cursor-pointer transition-all ${
                    level === 'disabled'
                      ? 'bg-onedark-surface border-onedark-red text-onedark-fgBright font-medium'
                      : 'bg-onedark-bg border-onedark-borderSubtle text-onedark-muted hover:text-onedark-fg'
                  }`}
                >
                  <input
                    type="radio"
                    name={`policy_${action}`}
                    checked={level === 'disabled'}
                    onChange={() => handleChange(action, 'disabled')}
                    className="hidden"
                  />
                  <div>
                    <div className="text-xs font-semibold">Disabled</div>
                    <div className="text-[10px] opacity-75">Action forbidden</div>
                  </div>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
