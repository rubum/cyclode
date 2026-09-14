import React from 'react';
import { FileCode } from 'lucide-react';
import { TaskDiff } from '../../types';

interface DiffViewerTabProps {
  diffs?: TaskDiff[];
  taskId?: string;
}

export const DiffViewerTab: React.FC<DiffViewerTabProps> = ({
  diffs = [],
}) => {
  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg font-sans text-xs">
      {/* Diff Content Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs text-onedark-fg">
        {diffs.length === 0 ? (
          <div className="p-8 text-center text-xs text-onedark-muted font-sans leading-relaxed">
            No modified files in this workspace session yet.<br />
            Changes generated during task runs will appear here as live diffs.
          </div>
        ) : (
          diffs.map((d) => (
            <div key={d.id || d.file_path} className="rounded border border-onedark-border bg-onedark-darker overflow-hidden shadow-xs">
              {/* Header */}
              <div className="px-3 py-1.5 bg-onedark-surface border-b border-onedark-border flex items-center justify-between text-onedark-fgBright">
                <div className="flex items-center space-x-2 text-[11px] font-mono truncate flex-1 min-w-0">
                  <FileCode className="w-3.5 h-3.5 text-onedark-accent flex-shrink-0" />
                  <span className="truncate">{d.file_path}</span>
                </div>

                <div className="flex items-center space-x-2 text-[10px] ml-2 flex-shrink-0">
                  <span className="text-onedark-green font-semibold">+{d.additions || 0}</span>
                  <span className="text-onedark-red font-semibold">-{d.deletions || 0}</span>
                </div>
              </div>

              {/* Lines */}
              <div className="p-2 overflow-x-auto text-[11px] leading-relaxed">
                {d.diff_content ? (
                  d.diff_content.split('\n').map((line, idx) => {
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
                            ? 'text-onedark-purple bg-onedark-surface/30 font-semibold'
                            : 'text-onedark-fg'
                        }`}
                      >
                        <pre className="font-mono whitespace-pre">{line || ' '}</pre>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-onedark-muted italic py-1 px-2">Binary or empty diff</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
