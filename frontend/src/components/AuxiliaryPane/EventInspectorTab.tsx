import React from 'react';
import { Inbox, CheckCircle2 } from 'lucide-react';
import { Task } from '../../types';

interface EventInspectorTabProps {
  task: Task | null;
}

export const EventInspectorTab: React.FC<EventInspectorTabProps> = ({ task }) => {
  if (!task || !task.event_id) {
    return (
      <div className="p-6 text-center text-xs text-zinc-500 font-mono">
        This task was triggered via direct chat / API rather than an inbound webhook event.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 font-mono text-xs">
      <div className="text-[10px] uppercase font-semibold text-zinc-500">
        Inbound Event Details
      </div>

      <div className="p-3 rounded-lg bg-dark-950 border border-dark-800 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-zinc-200 font-semibold">
            <Inbox className="w-3.5 h-3.5 text-brand-400" />
            <span>Event ID: {task.event_id.slice(0, 8)}...</span>
          </div>
          <span className="text-emerald-400 text-[10px] flex items-center space-x-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>HMAC Verified</span>
          </span>
        </div>

        <div className="pt-2 border-t border-dark-800 text-[11px] text-zinc-400">
          <div className="text-zinc-500 text-[10px] uppercase mb-1">Payload Metadata:</div>
          <pre className="p-2 rounded bg-dark-900 border border-dark-800 text-zinc-300 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify({
              task_id: task.id,
              event_id: task.event_id,
              persona: task.persona,
              model: task.model_name,
              created_at: task.created_at
            }, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
};
