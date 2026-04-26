import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe API to the renderer via window.api
const api = {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('save-settings', settings),

  // Keywords
  getKeywords: () => ipcRenderer.invoke('get-keywords'),
  saveKeyword: (keyword: unknown) => ipcRenderer.invoke('save-keyword', keyword),
  deleteKeyword: (id: string) => ipcRenderer.invoke('delete-keyword', id),
  toggleKeywordPause: (id: string) => ipcRenderer.invoke('toggle-keyword-pause', id),
  testTopicQuery: (opts: { terms: string[] }) =>
    ipcRenderer.invoke('test-topic-query', opts),

  // Alerts
  getAlerts: () => ipcRenderer.invoke('get-alerts'),
  getTopicRuns: () => ipcRenderer.invoke('get-topic-runs'),
  getNewsDetail: (id: number) => ipcRenderer.invoke('get-news-detail', id),
  triggerMockAlert: (level: 'high' | 'medium' | 'low') => ipcRenderer.invoke('trigger-mock-alert', level),
  markAlertRead: (id: string) => ipcRenderer.invoke('mark-alert-read', id),
  markAlertUnread: (id: string) => ipcRenderer.invoke('mark-alert-unread', id),
  markAllAlertsRead: () => ipcRenderer.invoke('mark-all-alerts-read'),
  clearAlerts: () => ipcRenderer.invoke('clear-alerts'),

  // Briefs
  getBriefs: () => ipcRenderer.invoke('get-briefs'),
  saveBrief: (brief: unknown) => ipcRenderer.invoke('save-brief', brief),

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Connections
  testFreenews: (opts: { apiKey: string; baseUrl: string }) =>
    ipcRenderer.invoke('test-freenews', opts),
  testAi: (opts: { baseUrl: string; apiKey: string; model: string; providerType?: 'openai' | 'anthropic' }) =>
    ipcRenderer.invoke('test-ai', opts),

  onBriefCreated: (cb: (data: unknown) => void) => {
    ipcRenderer.on('brief-created', (_event, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('brief-created')
  },

  // AI brief generation
  generateBrief: (opts: { topicIds: string[]; dateRange: string }) =>
    ipcRenderer.invoke('generate-brief', opts),

  // Monitor lifecycle
  getMonitorStatus: () => ipcRenderer.invoke('get-monitor-status'),
  startMonitor: () => ipcRenderer.invoke('start-monitor'),
  stopMonitor: () => ipcRenderer.invoke('stop-monitor'),

  // Utilities
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Listen for push updates from main process
  onMonitoringUpdate: (
    cb: (data: { keyword: unknown; alert?: unknown }) => void
  ) => {
    ipcRenderer.on('monitoring-update', (_event, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('monitoring-update')
  },

  onMonitorStateChange: (cb: (data: unknown) => void) => {
    ipcRenderer.on('monitor-state-changed', (_event, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('monitor-state-changed')
  },

  onTopicRunRecorded: (cb: (data: unknown) => void) => {
    ipcRenderer.on('topic-run-recorded', (_event, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('topic-run-recorded')
  },

  onOpenAlertDetail: (cb: (data: unknown) => void) => {
    ipcRenderer.on('open-alert-detail', (_event, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('open-alert-detail')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type ElectronAPI = typeof api
