import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScanStore } from '../stores/scanStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import type { ScanScope, ScanStrategy, DetectionCategory } from '../types';

const scopeOptions = [
  { value: 'page', label: 'Page — Single URL only' },
  { value: 'site', label: 'Site — Same domain, follow links' },
  { value: 'domain', label: 'Domain — All subdomains included' },
];

const strategyOptions = [
  { value: 'sequential', label: 'Sequential — One detection at a time' },
  { value: 'parallel', label: 'Parallel — Run detections concurrently' },
  { value: 'adaptive', label: 'Adaptive — Dynamic scheduling' },
];

const categoryOptions: { value: DetectionCategory; label: string; description: string }[] = [
  { value: 'security', label: 'Security', description: 'Vulnerabilities, XSS, CSRF, injection' },
  { value: 'performance', label: 'Performance', description: 'Load time, resource usage, metrics' },
  { value: 'seo', label: 'SEO', description: 'Meta tags, crawlability, structured data' },
  { value: 'accessibility', label: 'Accessibility', description: 'WCAG compliance, ARIA, keyboard nav' },
];

export const NewScan: React.FC = () => {
  const navigate = useNavigate();
  const { createScan, loading, error, clearError } = useScanStore();

  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<ScanScope>('page');
  const [strategy, setStrategy] = useState<ScanStrategy>('adaptive');
  const [categories, setCategories] = useState<DetectionCategory[]>(['security']);

  const toggleCategory = (category: DetectionCategory) => {
    setCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || categories.length === 0) return;

    try {
      const id = await createScan(url.trim(), scope, strategy, categories);
      navigate(`/scans/${id}`);
    } catch {
      // Error is handled by the store
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">New Scan</h1>
        <p className="mt-1 text-sm text-slate-400">Configure and launch a new website scan</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* URL Input */}
          <Input
            label="Target URL"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) clearError();
            }}
            required
            error={error ?? undefined}
            helperText="Enter the full URL of the website to scan"
          />

          {/* Scope Selector */}
          <Select
            label="Scan Scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ScanScope)}
            options={scopeOptions}
          />

          {/* Category Checkboxes */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300">
              Detection Categories
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {categoryOptions.map((cat) => (
                <label
                  key={cat.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    categories.includes(cat.value)
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-slate-600 bg-slate-800 hover:border-slate-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={categories.includes(cat.value)}
                    onChange={() => toggleCategory(cat.value)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-200">{cat.label}</span>
                    <p className="text-xs text-slate-400">{cat.description}</p>
                  </div>
                </label>
              ))}
            </div>
            {categories.length === 0 && (
              <p className="mt-2 text-xs text-red-400">Select at least one category</p>
            )}
          </div>

          {/* Strategy Selector */}
          <Select
            label="Scan Strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as ScanStrategy)}
            options={strategyOptions}
          />

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!url.trim() || categories.length === 0 || loading}
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Starting...
                </>
              ) : (
                'Start Scan'
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
