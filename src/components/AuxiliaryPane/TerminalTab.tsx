import React, { useState, useEffect } from 'react';
import { Activity, Search, ChevronsUpDown } from 'lucide-react';
import { TaskLog } from '../../types';
import { FormattedLogView } from '../Common/FormattedLogView';

interface TerminalTabProps {
  logs?: TaskLog[];
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ logs = [] }) => {
  const [filterQuery, setFilterQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(() => {
    if (logs.length === 0) return null;
    return logs[logs.length - 1].id || 'log-0';
  });

  // Automatically focus/expand the latest tool when new logs arrive
  useEffect(() => {
    if (logs.length > 0) {
      const latest = logs[logs.length - 1];
      setExpandedLogId(latest.id || `log-${logs.length - 1}`);
    }
  }, [logs.length]);

  const handleToggleLog = (id: string) => {
    setExpandedLogId((prev) => (prev === id ? null : id));
  };

  const filteredLogs = logs.filter((log) => {
    if (!filterQuery) return true;
    const query = filterQuery.toLowerCase();
    const toolName = (log.tool_name || '').toLowerCase();
    const output = (log.tool_output || '').toLowerCase();
    const inputStr = JSON.stringify(log.tool_input || {}).toLowerCase();
    return toolName.includes(query) || output.includes(query) || inputStr.includes(query);
  });

  return (
    <div className="flex flex-col h-full bg-onedark-darker overflow-hidden text-onedark-fg font-mono text-xs">
      {/* Search & Filter Bar */}
      <div className="p-2.5 border-b border-onedark-borderSubtle/60 bg-onedark-darker/80 flex items-center justify-between space-x-2 flex-shrink-0">
        <div className="flex items-center space-x-1.5 flex-1 bg-onedark-surface/40 border border-onedark-borderSubtle rounded-md px-2 py-1 text-xs">
          <Search className="w-3.5 h-3.5 text-onedark-muted" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter tool activities, files, or commands..."
            className="w-full bg-transparent text-onedark-fgBright placeholder-onedark-muted focus:outline-none text-[11px] font-mono"
          />
        </div>
        <div className="flex items-center space-x-1.5 text-[11px] text-onedark-muted font-mono flex-shrink-0">
          {logs.length > 0 && (
            <button
              type="button"
              onClick={() => setExpandedLogId((prev) => (prev ? null : (logs[logs.length - 1]?.id || 'log-0')))}
              className="p-1 rounded hover:bg-onedark-surface text-onedark-muted hover:text-onedark-fg transition-colors"
              title={expandedLogId ? 'Collapse all activities' : 'Expand latest activity'}
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
            </button>
          )}
          <span>
            {logs.length} tool{logs.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Logs Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text">
        {filteredLogs.length === 0 ? (
          <div className="text-onedark-muted text-xs p-8 text-center font-sans space-y-1">
            <Activity className="w-6 h-6 text-onedark-muted mx-auto mb-2 opacity-50" />
            <div>{logs.length === 0 ? 'No workspace tools executed yet.' : 'No matching tool activities found.'}</div>
          </div>
        ) : (
          filteredLogs.map((log, index) => {
            const logId = log.id || `log-${index}`;
            const isItemExpanded = expandedLogId === logId;
            return (
              <FormattedLogView
                key={logId}
                log={log}
                isExpanded={isItemExpanded}
                onToggle={() => handleToggleLog(logId)}
                isTerminalTab={true}
              />
            );
          })
        )}
      </div>
    </div>
  );
};
