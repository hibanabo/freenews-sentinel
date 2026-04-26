import keytar from 'keytar'
import { Settings } from './store'

/**
 * Secret storage bridge.
 *
 * Uses OS keychain when available; falls back to in-memory cache
 * for current process if keytar is unavailable.
 */
const SERVICE_NAME = 'freenews-sentinel'
const FREENEWS_KEY_ACCOUNT = 'freenews_api_key'
const AI_KEY_ACCOUNT = 'ai_api_key'

let loaded = false
let loadPromise: Promise<void> | null = null
let keytarAvailable = true

const cache = {
  freenewsApiKey: '',
  aiApiKey: ''
}

async function readSecret(account: string) {
  if (!keytarAvailable) return ''
  try {
    return (await keytar.getPassword(SERVICE_NAME, account)) ?? ''
  } catch (error) {
    keytarAvailable = false
    console.warn('[Secrets] keytar read failed, fallback to memory only:', (error as Error).message)
    return ''
  }
}

async function writeSecret(account: string, value: string) {
  if (!keytarAvailable) return
  try {
    if (!value) {
      await keytar.deletePassword(SERVICE_NAME, account)
    } else {
      await keytar.setPassword(SERVICE_NAME, account, value)
    }
  } catch (error) {
    keytarAvailable = false
    console.warn('[Secrets] keytar write failed, fallback to memory only:', (error as Error).message)
  }
}

async function ensureLoaded() {
  if (loaded) return
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const [freenewsApiKey, aiApiKey] = await Promise.all([
      readSecret(FREENEWS_KEY_ACCOUNT),
      readSecret(AI_KEY_ACCOUNT)
    ])

    cache.freenewsApiKey = freenewsApiKey
    cache.aiApiKey = aiApiKey
    loaded = true
    loadPromise = null
  })()

  return loadPromise
}

export async function initSecretStore() {
  await ensureLoaded()
}

export function hasSecureSecretStorage() {
  return keytarAvailable
}

export function stripSecrets(settings: Settings): Settings {
  return {
    ...settings,
    freenewsApiKey: '',
    aiApiKey: ''
  }
}

export function applyCachedSecrets(settings: Settings): Settings {
  const freenewsApiKey = settings.freenewsApiKey?.trim() || cache.freenewsApiKey
  const aiApiKey = settings.aiApiKey?.trim() || cache.aiApiKey
  return {
    ...settings,
    freenewsApiKey,
    aiApiKey
  }
}

export async function withSecrets(settings: Settings): Promise<Settings> {
  await ensureLoaded()
  return applyCachedSecrets(settings)
}

export async function saveSecrets(settings: Settings) {
  await ensureLoaded()
  const nextFreenewsApiKey = settings.freenewsApiKey?.trim() ?? ''
  const nextAiApiKey = settings.aiApiKey?.trim() ?? ''

  cache.freenewsApiKey = nextFreenewsApiKey
  cache.aiApiKey = nextAiApiKey

  await Promise.all([
    writeSecret(FREENEWS_KEY_ACCOUNT, nextFreenewsApiKey),
    writeSecret(AI_KEY_ACCOUNT, nextAiApiKey)
  ])
}
