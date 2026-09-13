import React, { useState, useEffect } from 'react';
import { FileCode2, Activity, Cpu, Inbox, Folder, Compass } from 'lucide-react';
import { Task } from '../../types';
import { DiffViewerTab } from './DiffViewerTab';
import { TerminalTab } from './TerminalTab';
import { SubagentsTab } from './SubagentsTab';
import { EventInspectorTab } from './EventInspectorTab';
import { FilesExplorerTab } from './FilesExplorerTab';
import { DocsViewerTab } from './DocsViewerTab';

interface AuxiliaryPaneProps {
  task: Task | null;
  previewTarget?: { url: string; title?: string } | null;
  onClearPreview?: () => void;
  onAskAboutRepo?: (repoName: string) => void;
  onCloneToSession?: (repoUrl: string, repoName: string) => void;
}

export const AuxiliaryPane: React.FC<AuxiliaryPaneProps> = ({ 
  task,
  previewTarget,
  onClearPreview,
  onAskAboutRepo,
  onCloneToSession,
}) => {
  const [activeTab, setActiveTab] = useState<'docs' | 'files' | 'diff' | 'activity' | 'subagents' | 'event'>(() => {
    if (previewTarget?.url) return 'docs';
    if (task?.diffs && task.diffs.length > 0) return 'diff';
    if (task?.repo_name || task?.repo_url) return 'files';
    return 'activity';
  });

  const lastUrlRef = React.useRef(previewTarget?.url);

  useEffect(() => {
    // When a link is clicked, auto-switch to docs tab
    if (previewTarget?.url && previewTarget.url !== lastUrlRef.current) {
      setActiveTab('docs');
    }
    lastUrlRef.current = previewTarget?.url;
  }, [previewTarget?.url]);

  useEffect(() => {
    if (!task) return;
    // When switching to a task that has no docs open or preview is cleared, switch to appropriate default tab
    if (activeTab === 'docs' && !previewTarget?.url) {
      if (task.diffs && task.diffs.length > 0) {
        setActiveTab('diff');
      } else if (task.repo_name || task.repo_url) {
        setActiveTab('files');
      } else {
        setActiveTab('activity');
      }
    }
  }, [task?.id, previewTarget?.url, activeTab]);

  const tabs = [
    { id: 'docs', label: 'Web & Docs', icon: Compass, badge: previewTarget?.url ? '●' : undefined },
    { id: 'files', label: 'Files', icon: Folder, iconClass: 'text-onedark-folder' },
    { id: 'diff', label: 'Diff', icon: FileCode2, count: task?.diffs?.length || 0 },
    { id: 'activity', label: 'Tool Activity', icon: Activity, count: task?.logs?.length || 0 },
    { id: 'subagents', label: 'Subagents', icon: Cpu },
    { id: 'event', label: 'Event', icon: Inbox },
  ];

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden select-none border-l border-onedark-borderSubtle text-onedark-fg">
      {/* Tab bar */}
      <div className="flex items-center border-b border-onedark-borderSubtle bg-onedark-darker px-2 pt-1 space-x-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all cursor-pointer ${
                isActive
                  ? 'border-onedark-accent text-onedark-fgBright bg-onedark-surface/60 rounded-t-md'
                  : 'border-transparent text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${tab.iconClass || ''}`} />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1 text-[10px] font-mono text-onedark-accent">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab body */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'docs' && (
          <DocsViewerTab
            url={previewTarget?.url || null}
            initialTitle={previewTarget?.title}
            onClear={onClearPreview}
            onAskAboutRepo={onAskAboutRepo}
            onCloneToSession={onCloneToSession}
          />
        )}
        {activeTab === 'files' && task && <FilesExplorerTab task={task} />}
        {activeTab === 'files' && !task && (
          <div className="h-full flex items-center justify-center text-xs text-onedark-muted font-mono">
            No active task selected
          </div>
        )}
        {activeTab === 'diff' && <DiffViewerTab diffs={task?.diffs} />}
        {activeTab === 'activity' && <TerminalTab logs={task?.logs} />}
        {activeTab === 'subagents' && <SubagentsTab task={task} />}
        {activeTab === 'event' && <EventInspectorTab task={task} />}
      </div>
    </div>
  );
};
