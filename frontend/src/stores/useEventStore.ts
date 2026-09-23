import { useState, useCallback, useEffect } from "react";
import {
  EventItem,
  AutomationRule,
  PolicyMap,
  Integration,
  RepositoryConfig,
  SkillCatalogItem,
  WebhookEndpoint,
} from "../types";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface EventStoreState {
  events: EventItem[];
  automations: AutomationRule[];
  policies: PolicyMap;
  integrations: Integration[];
  repositories: RepositoryConfig[];
  activeSkills: string[];
  skillsCatalog: SkillCatalogItem[];
  webhookEndpoints: WebhookEndpoint[];
  fetchEvents: () => Promise<void>;
  fetchAutomations: () => Promise<void>;
  fetchPolicies: () => Promise<void>;
  fetchIntegrations: () => Promise<void>;
  fetchRepositories: () => Promise<void>;
  fetchSkillsCatalog: () => Promise<void>;
  fetchWebhookEndpoints: () => Promise<void>;
  setEvents: React.Dispatch<React.SetStateAction<EventItem[]>>;
  setAutomations: React.Dispatch<React.SetStateAction<AutomationRule[]>>;
  setPolicies: React.Dispatch<React.SetStateAction<PolicyMap>>;
  setIntegrations: React.Dispatch<React.SetStateAction<Integration[]>>;
  setRepositories: React.Dispatch<React.SetStateAction<RepositoryConfig[]>>;
  setActiveSkills: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useEventStore(): EventStoreState {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [policies, setPolicies] = useState<PolicyMap>({});
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [repositories, setRepositories] = useState<RepositoryConfig[]>([]);
  const [activeSkills, setActiveSkills] = useState<string[]>([]);
  const [skillsCatalog, setSkillsCatalog] = useState<SkillCatalogItem[]>([]);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpoint[]>([]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/events`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (err) {
      console.error("Error fetching events:", err);
    }
  }, []);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/automations`);
      if (res.ok) {
        const data = await res.json();
        setAutomations(data);
      }
    } catch (err) {
      console.error("Error fetching automations:", err);
    }
  }, []);

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/policies`);
      if (res.ok) {
        const data = await res.json();
        setPolicies(data);
      }
    } catch (err) {
      console.error("Error fetching policies:", err);
    }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/integrations`);
      if (res.ok) {
        const data = await res.json();
        setIntegrations(data);
      }
    } catch (err) {
      console.error("Error fetching integrations:", err);
    }
  }, []);

  const fetchRepositories = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/repositories`);
      if (res.ok) {
        const data = await res.json();
        setRepositories(data);
      }
    } catch (err) {
      console.error("Error fetching repositories:", err);
    }
  }, []);

  const fetchSkillsCatalog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/integrations/skills`);
      if (res.ok) {
        const data = await res.json();
        setSkillsCatalog(data);
      }
    } catch (err) {
      console.error("Error fetching skills catalog:", err);
    }
  }, []);

  const fetchWebhookEndpoints = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/webhooks/endpoints`);
      if (res.ok) {
        const data = await res.json();
        setWebhookEndpoints(data);
      }
    } catch (err) {
      console.error("Error fetching webhook endpoints:", err);
    }
  }, []);

  return {
    events,
    automations,
    policies,
    integrations,
    repositories,
    activeSkills,
    skillsCatalog,
    webhookEndpoints,
    fetchEvents,
    fetchAutomations,
    fetchPolicies,
    fetchIntegrations,
    fetchRepositories,
    fetchSkillsCatalog,
    fetchWebhookEndpoints,
    setEvents,
    setAutomations,
    setPolicies,
    setIntegrations,
    setRepositories,
    setActiveSkills,
  };
}
