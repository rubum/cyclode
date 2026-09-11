import React, { useState } from 'react';
import { Inbox, CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { EventItem } from '../../types';

interface EventInboxProps {
  events: EventItem[];
  onRefresh: () => void;
}

export const EventInbox: React.FC<EventInboxProps> = ({ events, onRefresh }) => {
  const [expandedEvents, setExpandedEvents] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedEvents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-dark-950">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center space-x-2">
            <Inbox className="w-5 h-5 text-brand-400" />
            <span>Event Ingestion & Webhook Inbox</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Audit log of incoming webhooks from GitHub, AppSignal, Slack, and REST APIs.
          </p>
        </div>

        <button
          onClick={onRefresh}
          className="px-3 py-1.5 rounded-lg bg-dark-850 hover:bg-dark-800 text-zinc-300 hover:text-white border border-dark-800 text-xs flex items-center space-x-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="space-y-3">
        {events.length === 0 ? (
          <div className="p-12 text-center rounded-2xl bg-dark-900/40 border border-dark-800 text-zinc-500 text-xs">
            No events received yet. Try triggering a simulated webhook in the Webhook Simulator tab.
          </div>
        ) : (
          events.map((ev) => {
            const isExpanded = expandedEvents[ev.id];
            return (
              <div key={ev.id} className="rounded-xl border border-dark-800 bg-dark-900 overflow-hidden text-xs">
                <div
                  onClick={() => toggleExpand(ev.id)}
                  className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-dark-850 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <div className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20 uppercase font-mono text-[10px]">
                      {ev.source}
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-200">{ev.event_type}</div>
                      <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{ev.created_at}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    {ev.signature_valid ? (
                      <span className="text-emerald-400 flex items-center space-x-1 text-[11px] font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>HMAC Verified</span>
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center space-x-1 text-[11px] font-mono">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Unsigned</span>
                      </span>
                    )}
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="p-4 border-t border-dark-800 bg-dark-950 font-mono text-[11px] text-zinc-300">
                    <div className="text-zinc-500 text-[10px] uppercase mb-1">Payload:</div>
                    <pre className="p-3 rounded bg-dark-900 border border-dark-800 text-zinc-200 overflow-x-auto whitespace-pre-wrap">
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
