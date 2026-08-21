import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';

interface SettingsState {
  llmProvider: string;
  llmModel: string;
  apiKey: string;
  maxTurns: string;
  timeout: string;
  strategy: string;
  maxDepth: string;
  maxPages: string;
  rateLimit: string;
}

const providerOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'deepseek', label: 'DeepSeek' },
];

const strategyOptions = [
  { value: 'sequential', label: 'Sequential' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'adaptive', label: 'Adaptive' },
];

const defaultSettings: SettingsState = {
  llmProvider: 'ollama',
  llmModel: 'llama3.2',
  apiKey: '',
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
        <p className="mt-1 text-sm text-slate-400">Configure scan defaults and LLM provider</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* LLM Provider Config */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">LLM Provider</h2>
          <div className="space-y-4">
            <Select
              label="Provider"
              value={settings.llmProvider}
              onChange={(e) => update('llmProvider', e.target.value)}
              options={providerOptions}
            />
            <Input
              label="Model"
              value={settings.llmModel}
              onChange={(e) => update('llmModel', e.target.value)}
              placeholder="e.g. llama3.2, gpt-4o, claude-3"
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

        {/* Scan Defaults */}
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-100">Scan Defaults</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Max Turns"
                type="number"
                value={settings.maxTurns}
                onChange={(e) => update('maxTurns', e.target.value)}
                min="1"
                max="100"
                helperText="Maximum agent reasoning turns per scan"
              />
              <Input
                label="Timeout (seconds)"
                type="number"
                value={settings.timeout}
                onChange={(e) => update('timeout', e.target.value)}
                min="30"
                max="3600"
                helperText="Scan timeout in seconds"
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
