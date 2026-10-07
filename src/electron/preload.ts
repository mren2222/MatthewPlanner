import { contextBridge, ipcRenderer } from 'electron';
import type { PlannerAPI } from '../core/types';
const api: PlannerAPI = {
  snapshot: () => ipcRenderer.invoke('planner:snapshot'),
  apply: (actions, revision) => ipcRenderer.invoke('planner:apply', actions, revision),
  undo: () => ipcRenderer.invoke('planner:undo'),
  chat: message => ipcRenderer.invoke('planner:chat', message),
  applyProposal: id => ipcRenderer.invoke('planner:applyProposal', id),
  cancelProposal: id => ipcRenderer.invoke('planner:cancelProposal', id),
  reviewToday: () => ipcRenderer.invoke('planner:reviewToday'),
  saveSettings: settings => ipcRenderer.invoke('planner:saveSettings', settings),
  listCalendars: () => ipcRenderer.invoke('planner:listCalendars'),
  syncCalendar: () => ipcRenderer.invoke('planner:syncCalendar'),
  publishEvent: eventId => ipcRenderer.invoke('planner:publishEvent', eventId)
};
contextBridge.exposeInMainWorld('planner', api);
