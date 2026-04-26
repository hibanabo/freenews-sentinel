import { BrowserWindow, shell, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { Alert } from './store'

// ── Window creation ──────────────────────────────────────────────────────────

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#070b12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  nativeTheme.themeSource = 'dark'

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ── Window helpers ───────────────────────────────────────────────────────────

export function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export function focusMainWindow(): BrowserWindow | null {
  const win = getMainWindow()
  if (!win) return null
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  return win
}

export function emitOpenAlertDetail(alertId: string): void {
  const win = focusMainWindow()
  if (!win) return
  win.webContents.send('open-alert-detail', { alertId })
}

// ── Notifications ────────────────────────────────────────────────────────────

export function showAlertNotification(alert: Alert, sound: boolean, icon?: string): void {
  const notification = new Notification({
    title: `${icon ?? '🟡'} FreeNews Sentinel — ${alert.keywordName}`,
    body: alert.reason,
    silent: !sound
  })
  notification.on('click', () => {
    emitOpenAlertDetail(alert.id)
  })
  notification.show()
}
