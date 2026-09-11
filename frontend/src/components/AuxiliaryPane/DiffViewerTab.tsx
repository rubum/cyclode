import React from 'react';
import { FileCode } from 'lucide-react';
import { TaskDiff } from '../../types';

interface DiffViewerTabProps {
  diffs?: TaskDiff[];
}

export const DiffViewerTab: React.FC<DiffViewerTabProps> = ({ diffs = [] }) => {
  if (diffs.length === 0) {
    return (
      <div className="p-8 text-center text-xs text-onedark-muted font-sans">
        No modified files in this workspace yet.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 font-mono text-xs text-onedark-fg">
      {diffs.map((d) => (
        <div key={d.id || d.file_path} className="rounded border border-onedark-border bg-onedark-darker overflow-hidden">
          {/* Header */}
          <div className="px-3 py-1.5 bg-onedark-surface border-b border-onedark-border flex items-center justify-between text-onedark-fgBright">
            <div className="flex items-center space-x-2 text-[11px] font-mono">
              <FileCode className="w-3.5 h-3.5 text-onedark-accent" />
              <span>{d.file_path}</span>
            </div>

            <div className="flex items-center space-x-2 text-[10px]">
              <span className="text-onedark-green">+{d.additions || 0}</span>
              <span className="text-onedark-red">-{d.deletions || 0}</span>
            </div>
          </div>

          {/* Lines */}
          <div className="p-2 overflow-x-auto text-[11px] leading-relaxed">
            {d.diff_content.split('\n').map((line, idx) => {
              const isAddition = line.startsWith('+') && !line.startsWith('+++');
              const isDeletion = line.startsWith('-') && !line.startsWith('---');
              const isHeader = line.startsWith('@@');

              return (
                <div
                  key={idx}
                  className={`px-1 py-0.5 rounded-sm ${
                    isAddition
                      ? 'diff-addition'
                      : isDeletion
                      ? 'diff-deletion'
                      : isHeader
                      ? 'text-onedark-purple bg-onedark-surface/30'
                      : 'text-onedark-fg'
                  }`}
                >
                  <pre className="font-mono whitespace-pre">{line || ' '}</pre>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
