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
  disabledCapabilities: string[];
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
  setSkillsCatalog: React.Dispatch<React.SetStateAction<SkillCatalogItem[]>>;
  setWebhookEndpoints: React.Dispatch<React.SetStateAction<WebhookEndpoint[]>>;
  setDisabledCapabilities: React.Dispatch<React.SetStateAction<string[]>>;
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
  const [disabledCapabilities, setDisabledCapabilities] = useState<string[]>([]);


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
        setIntegrations(data.integrations || []);
        setActiveSkills(data.active_skills || []);
        setSkillsCatalog(data.skills_catalog || []);
        setWebhookEndpoints(data.webhook_endpoints || []);
        if (Array.isArray(data.disabled_capabilities)) {
          setDisabledCapabilities(data.disabled_capabilities);
        }
      }
    } catch (err) {
      console.error("Error fetching integrations:", err);
    }
  }, []);

  const fetchRepositories = useCallback(async () => {
    const endpoints = [
      `${API_BASE}/api/repositories`,
      '/api/repositories',
      'http://localhost:8000/api/repositories',
      'http://127.0.0.1:8000/api/repositories',
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setRepositories(data);
            return;
          }
        }
      } catch {
        // try next endpoint
      }
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
    disabledCapabilities,
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
    setSkillsCatalog,
    setWebhookEndpoints,
    setDisabledCapabilities,
  };
}
