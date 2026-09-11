import React, { useState } from 'react';
import { FileCode2, Activity, Cpu, Inbox } from 'lucide-react';
import { Task } from '../../types';
import { DiffViewerTab } from './DiffViewerTab';
import { TerminalTab } from './TerminalTab';
import { SubagentsTab } from './SubagentsTab';
import { EventInspectorTab } from './EventInspectorTab';

interface AuxiliaryPaneProps {
  task: Task | null;
}

export const AuxiliaryPane: React.FC<AuxiliaryPaneProps> = ({ task }) => {
  const [activeTab, setActiveTab] = useState<'diff' | 'activity' | 'subagents' | 'event'>('diff');

  const tabs = [
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
              className={`flex items-center space-x-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all ${
                isActive
                  ? 'border-onedark-accent text-onedark-fgBright bg-onedark-surface/60 rounded-t-md'
                  : 'border-transparent text-onedark-muted hover:text-onedark-fg'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
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
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'diff' && <DiffViewerTab diffs={task?.diffs} />}
        {activeTab === 'activity' && <TerminalTab logs={task?.logs} />}
        {activeTab === 'subagents' && <SubagentsTab task={task} />}
        {activeTab === 'event' && <EventInspectorTab task={task} />}
      </div>
    </div>
  );
};
