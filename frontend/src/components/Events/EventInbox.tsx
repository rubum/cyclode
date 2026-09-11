import React, { useState, useMemo } from 'react';
import { 
  Inbox, 
  CheckCircle2, 
  AlertTriangle, 
  ChevronDown, 
  ChevronRight, 
  RefreshCw, 
  Bot, 
  ArrowUpRight, 
  Copy, 
  Check, 
  Radio, 
  Search
} from 'lucide-react';
import { EventItem } from '../../types';

interface EventInboxProps {
  events: EventItem[];
  onRefresh: () => void;
  onSelectTask?: (taskId: string) => void;
}

export const EventInbox: React.FC<EventInboxProps> = ({ events, onRefresh, onSelectTask }) => {
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedEvents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyPayload = (ev: EventItem, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(ev.payload, null, 2));
    setCopiedId(ev.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (selectedSource !== 'all' && ev.source.toLowerCase() !== selectedSource.toLowerCase()) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const eventType = (ev.event_type || '').toLowerCase();
        const source = (ev.source || '').toLowerCase();
        const payloadStr = JSON.stringify(ev.payload || {}).toLowerCase();
        return eventType.includes(q) || source.includes(q) || payloadStr.includes(q);
      }
      return true;
    });
  }, [events, selectedSource, searchQuery]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: events.length, github: 0, slack: 0, appsignal: 0, generic: 0 };
    events.forEach((ev) => {
      const s = (ev.source || 'generic').toLowerCase();
      if (counts[s] !== undefined) {
        counts[s]++;
      } else {
        counts.generic = (counts.generic || 0) + 1;
      }
    });
    return counts;
  }, [events]);

  const getSourceBadgeStyle = (source: string) => {
    switch (source.toLowerCase()) {
      case 'github':
        return 'bg-onedark-purple/15 text-onedark-purple border-onedark-purple/30';
      case 'slack':
        return 'bg-onedark-green/15 text-onedark-green border-onedark-green/30';
      case 'appsignal':
        return 'bg-onedark-red/15 text-onedark-red border-onedark-red/30';
      default:
        return 'bg-onedark-accent/15 text-onedark-accent border-onedark-accent/30';
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-onedark-bg font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle text-onedark-accent shadow-xs">
              <Inbox className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-onedark-fgBright flex items-center space-x-2">
                <span>Event Ingestion & Webhook Inbox</span>
                <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-onedark-green/10 text-onedark-green border border-onedark-green/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-onedark-green animate-pulse" />
                  <span>LIVE LISTENER</span>
                </span>
              </h1>
              <p className="text-xs text-onedark-muted mt-0.5">
                Real-time audit log of incoming webhooks from GitHub, AppSignal, Slack, and REST APIs.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2 self-start sm:self-auto">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg bg-onedark-darker hover:bg-onedark-surface text-onedark-fg hover:text-onedark-fgBright border border-onedark-borderSubtle text-xs flex items-center space-x-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 text-onedark-accent" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center space-x-1.5 bg-onedark-darker p-1 rounded-xl border border-onedark-borderSubtle text-xs overflow-x-auto">
          {[
            { key: 'all', label: 'All Sources' },
            { key: 'github', label: 'GitHub' },
            { key: 'slack', label: 'Slack' },
            { key: 'appsignal', label: 'AppSignal' },
            { key: 'generic', label: 'Generic' },
          ].map((tab) => {
            const count = sourceCounts[tab.key] || 0;
            const isSelected = selectedSource === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setSelectedSource(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 whitespace-nowrap ${
                  isSelected
                    ? 'bg-onedark-surface text-onedark-fgBright shadow-xs border border-onedark-border font-semibold'
                    : 'text-onedark-muted hover:text-onedark-fg'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isSelected ? 'bg-onedark-accent/20 text-onedark-accent' : 'bg-onedark-borderSubtle text-onedark-muted'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-onedark-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events, payloads, branches..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-onedark-darker border border-onedark-borderSubtle text-xs text-onedark-fgBright placeholder:text-onedark-muted focus:outline-none focus:border-onedark-accent transition-colors font-mono"
          />
        </div>
      </div>

      {/* Events List */}
      <div className="space-y-3">
        {filteredEvents.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-onedark-darker/60 border border-onedark-borderSubtle text-onedark-muted space-y-3">
            <Radio className="w-8 h-8 mx-auto text-onedark-muted opacity-40 animate-pulse" />
            <div className="space-y-1">
              <div className="text-xs font-semibold text-onedark-fgBright">No incoming events matching filters</div>
              <p className="text-[11px] text-onedark-muted max-w-sm mx-auto">
                Trigger a simulated webhook in the Webhook Simulator tab, or push a commit/PR to a connected repository.
              </p>
            </div>
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const isExpanded = expandedEvents[ev.id];
            const payloadRepo = ev.payload?.repository?.full_name || ev.payload?.repo || '';
            const prNumber = ev.payload?.pull_request?.number || ev.payload?.number;
            const targetTaskId = ev.payload?.task_id || (ev as any).task_id;

            return (
              <div
                key={ev.id}
                className="rounded-xl border border-onedark-borderSubtle bg-onedark-darker overflow-hidden text-xs hover:border-onedark-border transition-all shadow-xs"
              >
                {/* Event Row Header */}
                <div
                  onClick={() => toggleExpand(ev.id)}
                  className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-onedark-surface/50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <span
                      className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase tracking-wider border ${getSourceBadgeStyle(
                        ev.source
                      )}`}
                    >
                      {ev.source}
                    </span>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-onedark-fgBright font-mono">{ev.event_type}</span>
                        {payloadRepo && (
                          <span className="text-[11px] text-onedark-muted font-mono bg-onedark-surface px-1.5 py-0.5 rounded border border-onedark-borderSubtle">
                            {payloadRepo}
                            {prNumber ? ` #${prNumber}` : ''}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-onedark-muted font-mono mt-0.5">{ev.created_at}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 self-end sm:self-auto">
                    {/* Security Signature Status */}
                    {ev.signature_valid ? (
                      <span className="text-onedark-green flex items-center space-x-1 text-[11px] font-mono bg-onedark-green/10 px-2 py-0.5 rounded border border-onedark-green/20">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>HMAC Verified</span>
                      </span>
                    ) : (
                      <span className="text-onedark-yellow flex items-center space-x-1 text-[11px] font-mono bg-onedark-yellow/10 px-2 py-0.5 rounded border border-onedark-yellow/20">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Unsigned / Local</span>
                      </span>
                    )}

                    {/* Quick Link to Spawned Agent Task */}
                    {onSelectTask && targetTaskId && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTask(targetTaskId);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-onedark-accent/15 hover:bg-onedark-accent/25 text-onedark-accent text-[11px] font-semibold flex items-center space-x-1 border border-onedark-accent/30 transition-colors"
                        title="Jump to Agent Chat & Sandbox"
                      >
                        <Bot className="w-3 h-3" />
                        <span>Inspect Task</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    )}

                    <div className="p-1 text-onedark-muted">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded Payload & Diagnostics */}
                {isExpanded && (
                  <div className="p-4 border-t border-onedark-borderSubtle bg-onedark-bg/95 font-mono text-[11px] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-onedark-muted text-[10px] uppercase font-semibold tracking-wider">
                        Webhook Payload & Diagnostics
                      </span>
                      <button
                        onClick={(e) => handleCopyPayload(ev, e)}
                        className="inline-flex items-center space-x-1 text-[11px] text-onedark-muted hover:text-onedark-fg px-2 py-1 rounded bg-onedark-darker border border-onedark-borderSubtle transition-colors"
                      >
                        {copiedId === ev.id ? (
                          <>
                            <Check className="w-3 h-3 text-onedark-green" />
                            <span className="text-onedark-green">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy JSON</span>
                          </>
                        )}
                      </button>
                    </div>

                    <pre className="p-3 rounded-xl bg-onedark-darker border border-onedark-borderSubtle text-onedark-fg overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-80">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
