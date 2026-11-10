import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push(kind: ToastKind, text: string, ttlMs?: number): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, text, ttlMs = 5000) {
    // Одинаковые сообщения подряд не плодим.
    if (get().toasts.some((t) => t.text === text)) return;
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  info: (text: string) => useToasts.getState().push('info', text),
  success: (text: string) => useToasts.getState().push('success', text),
  error: (text: string) => useToasts.getState().push('error', text, 7000),
};
