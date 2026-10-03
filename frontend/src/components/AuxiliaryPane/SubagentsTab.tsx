import React from 'react';
import { AgentsTab } from './AgentsTab';
import { Task } from '../../types';

interface SubagentsTabProps {
  task: Task | null;
  onOpenSubsession?: (subtaskId: string) => void;
}

export const SubagentsTab: React.FC<SubagentsTabProps> = (props) => {
  return <AgentsTab {...props} />;
};

export { AgentsTab };
