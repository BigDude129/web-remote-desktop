import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024;
export const keyCodes = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((key) => `Key${key}`),
  ...'0123456789'.split('').map((key) => `Digit${key}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  'Enter',
  'Escape',
  'Backspace',
  'Tab',
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Delete',
  'Insert',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'Lang1',
] as const;

export const inputSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('move'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .strict(),
  z
    .object({
      kind: z.literal('button'),
      button: z.enum(['left', 'right', 'middle']),
      down: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('wheel'), delta: z.number().int().min(-1200).max(1200) }).strict(),
  z
    .object({
      kind: z.literal('key'),
      code: z.string().refine((value) => keyCodes.includes(value as (typeof keyCodes)[number])),
      down: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('release') }).strict(),
]);
export type RemoteInput = z.infer<typeof inputSchema>;
export interface User {
  id: string;
  username: string;
  name: string;
}
export interface Device {
  id: string;
  name: string;
  platform: string;
  agentVersion: string;
  lastSeen: number;
  createdAt: number;
  online: boolean;
  busy: boolean;
}
export interface AuditEvent {
  id: string;
  event: string;
  deviceName: string | null;
  createdAt: number;
}
export interface RemoteSession {
  id: string;
  deviceId: string;
  state: string;
  expiresAt: number;
}
