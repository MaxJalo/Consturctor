export type AdminThemeId =
  | 'classic'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'violet'
  | 'midnight'
  | 'rose'

export interface AdminThemeOption {
  id: AdminThemeId
  name: string
  description: string
  swatches: [string, string, string]
}

export const ADMIN_THEMES: AdminThemeOption[] = [
  {
    id: 'classic',
    name: 'Классическая',
    description: 'Фирменный синий интерфейс',
    swatches: ['#1a73e8', '#eef3f8', '#0b2744']
  },
  {
    id: 'ocean',
    name: 'Океан',
    description: 'Глубокие морские оттенки',
    swatches: ['#0d9488', '#e6fffb', '#134e4a']
  },
  {
    id: 'forest',
    name: 'Лес',
    description: 'Спокойная зелёная палитра',
    swatches: ['#2f9e44', '#ebfbee', '#1b4332']
  },
  {
    id: 'sunset',
    name: 'Закат',
    description: 'Тёплые янтарные акценты',
    swatches: ['#e67700', '#fff4e6', '#5c3d1e']
  },
  {
    id: 'violet',
    name: 'Фиалка',
    description: 'Мягкий фиолетовый стиль',
    swatches: ['#7c3aed', '#f3f0ff', '#3b0764']
  },
  {
    id: 'midnight',
    name: 'Полночь',
    description: 'Контрастный slate-режим',
    swatches: ['#334155', '#f1f5f9', '#0f172a']
  },
  {
    id: 'rose',
    name: 'Роза',
    description: 'Элегантные розовые тона',
    swatches: ['#e03131', '#fff0f0', '#5c1a1a']
  }
]

const STORAGE_KEY = 'admin-theme'

export function readAdminTheme(): AdminThemeId {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && ADMIN_THEMES.some((theme) => theme.id === saved)) {
    return saved as AdminThemeId
  }
  return 'classic'
}

export function applyAdminTheme(id: AdminThemeId): void {
  document.documentElement.setAttribute('data-admin-theme', id)
  localStorage.setItem(STORAGE_KEY, id)
}

export function initAdminTheme(): void {
  applyAdminTheme(readAdminTheme())
}
