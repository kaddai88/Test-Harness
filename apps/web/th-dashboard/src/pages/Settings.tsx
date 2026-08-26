import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';

interface SettingsState {
  llmProvider: string;
  llmModel: string;
  apiKey: string;
  baseUrl: string;
  maxTurns: string;
  timeout: string;
  strategy: string;
  maxDepth: string;
  maxPages: string;
  rateLimit: string;
}

const providerOptions = [
  { value: 'qwen', label: 'Qwen (DashScope)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama (Local)' },
];

const strategyOptions = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'adaptive', label: 'Adaptive' },
];

const defaultSettings: SettingsState = {
  llmProvider: 'qwen',
  llmModel: 'qwen-plus',
  apiKey: '',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  maxTurns: '25',
  timeout: '300',
  strategy: 'adaptive',
  maxDepth: '3',
  maxPages: '50',
  rateLimit: '10',
};

export const Settings: React.FC = () => {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [saved, setSaved] = useState(false);

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const getProviderDefaults = (provider: string): { model: string; baseUrl: string } => {
    const defaults: Record<string, { model: string; baseUrl: string }> = {
      qwen: { model: 'qwen-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
      openai: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
      deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' },
      ollama: { model: 'llama3.1', baseUrl: 'http://localhost:11434' },
    };
    return defaults[provider] ?? defaults.ollama!;
  };

  const handleProviderChange = (provider: string) => {
    const defaults = getProviderDefaults(provider);
    setSettings((prev) => ({
      ...prev,
      llmProvider: provider,
      llmModel: defaults.model,
      baseUrl: defaults.baseUrl,
    }));
    setSaved(false);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem('th-dashboard-settings', JSON.stringify(settings));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Ignore storage errors
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Configure session defaults and LLM provider</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* LLM Provider Config */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">LLM Provider</h2>
          <div className="space-y-4">
            <Select
              label="Provider"
              value={settings.llmProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              options={providerOptions}
            />
            <Input
              label="Base URL"
              value={settings.baseUrl}
              onChange={(e) => update('baseUrl', e.target.value)}
              placeholder="https://api.example.com/v1"
              helperText="API endpoint URL. Auto-filled when switching provider."
            />
            <Input
              label="Model"
              value={settings.llmModel}
              onChange={(e) => update('llmModel', e.target.value)}
              placeholder="e.g. qwen-plus, gpt-4o, llama3.1"
            />
            <Input
              label="API Key"
              type="password"
              value={settings.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
              placeholder="sk-..."
              helperText="Required for cloud providers. Leave empty for local models."
            />
          </div>
        </Card>

        {/* Session Defaults */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Session Defaults</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Max Turns"
                type="number"
                value={settings.maxTurns}
                onChange={(e) => update('maxTurns', e.target.value)}
                min="1"
                max="100"
                helperText="Maximum agent reasoning turns per session"
              />
              <Input
                label="Timeout (seconds)"
                type="number"
                value={settings.timeout}
                onChange={(e) => update('timeout', e.target.value)}
                min="30"
                max="3600"
                helperText="Session timeout in seconds"
              />
            </div>
            <Select
              label="Default Strategy"
              value={settings.strategy}
              onChange={(e) => update('strategy', e.target.value)}
              options={strategyOptions}
            />
          </div>
        </Card>

        {/* Crawl Config */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Crawl Configuration</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Max Depth"
              type="number"
              value={settings.maxDepth}
              onChange={(e) => update('maxDepth', e.target.value)}
              min="1"
              max="10"
              helperText="Link follow depth"
            />
            <Input
              label="Max Pages"
              type="number"
              value={settings.maxPages}
              onChange={(e) => update('maxPages', e.target.value)}
              min="1"
              max="1000"
              helperText="Maximum pages to crawl"
            />
            <Input
              label="Rate Limit (req/s)"
              type="number"
              value={settings.rateLimit}
              onChange={(e) => update('rateLimit', e.target.value)}
              min="1"
              max="100"
              helperText="Requests per second"
            />
          </div>
        </Card>

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          {saved && (
            <span className="text-sm text-emerald-400 animate-fade-in">
              ✓ Settings saved
            </span>
          )}
          <Button type="submit">Save Settings</Button>
        </div>
      </form>
    </div>
  );
};
