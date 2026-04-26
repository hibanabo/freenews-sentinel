export const FREENEWS_SITE_URL = 'https://freenews.site'

export const AI_PROVIDER_PRESETS = [
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    note: '标准 OpenAI 接口',
    providerType: 'openai'
  },
  {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b-instruct',
    note: '本地模型，无需外网',
    providerType: 'openai'
  },
  {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    note: 'Anthropic Messages API',
    providerType: 'anthropic'
  },
  {
    label: '自定义兼容接口',
    baseUrl: '',
    model: '',
    note: '任何兼容 /chat/completions 的服务',
    providerType: 'openai'
  }
] as const
