import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { WebSocketEvent } from '../types';

interface WebSocketContextType {
  isConnected: boolean;
  isConnecting: boolean;
  lastEvent: WebSocketEvent | null;
  subscribe: (eventType: string, callback: (data: any) => void) => () => void;
  sendMessage: (message: any) => void;
  reconnect: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const reconnectTimeoutRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);

  const getWsUrl = () => {
    if (import.meta.env.VITE_WS_URL) {
      try {
        const u = new URL(import.meta.env.VITE_WS_URL);
        if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && window.location.hostname) {
          u.hostname = window.location.hostname;
        }
        return u.toString();
      } catch {
        return import.meta.env.VITE_WS_URL;
      }
    }

    if (import.meta.env.VITE_API_URL) {
      try {
        const apiUrl = new URL(import.meta.env.VITE_API_URL, window.location.origin);
        const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const hostname = (apiUrl.hostname === 'localhost' || apiUrl.hostname === '127.0.0.1') && window.location.hostname
          ? window.location.hostname
          : apiUrl.hostname;
        const port = apiUrl.port || (apiUrl.protocol === 'https:' ? '443' : '80');
        return `${protocol}//${hostname}:${port}/ws/live`;
      } catch {
        // fallback
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const host = isLocalDev && window.location.port !== '8000'
      ? `${window.location.hostname}:8000`
      : window.location.host;
    return `${protocol}//${host}/ws/live`;
  };

  const connect = useCallback(() => {
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsConnecting(true);
    const url = getWsUrl();
    try {
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);

        // Start heartbeat ping every 25 seconds to keep connection alive
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'PING' }));
            } catch {
              // ignore
            }
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const parsed: WebSocketEvent = JSON.parse(event.data);

          // Avoid re-rendering all context consumers on high-frequency stream chunks
          if (parsed.type !== 'STREAM_CHUNK') {
            setLastEvent(parsed);
          }

          // Notify specific event subscribers
          const handlers = subscribersRef.current.get(parsed.type);
          if (handlers) {
            handlers.forEach((fn) => fn(parsed.data));
          }

          // Notify wildcard subscribers
          const allHandlers = subscribersRef.current.get('*');
          if (allHandlers) {
            allHandlers.forEach((fn) => fn(parsed));
          }
        } catch (err) {
          console.error('Error parsing WS message:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        // Auto reconnect after 2 seconds
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, 2000);
        }
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      };
    } catch {
      setIsConnected(false);
      setIsConnecting(false);
      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, 2000);
      }
    }
  }, []);

  const reconnect = useCallback(() => {
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    // Reconnect immediately on tab visibility change or network online
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
          connect();
        }
      }
    };

    const handleOnline = () => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) socketRef.current.close();
    };
  }, [connect]);

  const subscribe = useCallback((eventType: string, callback: (data: any) => void) => {
    if (!subscribersRef.current.has(eventType)) {
      subscribersRef.current.set(eventType, new Set());
    }
    subscribersRef.current.get(eventType)!.add(callback);

    return () => {
      const handlers = subscribersRef.current.get(eventType);
      if (handlers) {
        handlers.delete(callback);
        if (handlers.size === 0) {
          subscribersRef.current.delete(eventType);
        }
      }
    };
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }, []);

  return (
    <WebSocketContext.Provider value={{ isConnected, isConnecting, lastEvent, subscribe, sendMessage, reconnect }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};
