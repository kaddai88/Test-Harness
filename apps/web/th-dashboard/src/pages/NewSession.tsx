import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../stores/sessionStore';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const NewSession: React.FC = () => {
  const navigate = useNavigate();
  const { createSession, loading, error, clearError } = useSessionStore();

  const [url, setUrl] = useState('');
  const [instructions, setInstructions] = useState('');

  // Load settings from localStorage
  const getSettingsMaxTurns = (): number | undefined => {
    try {
      const raw = localStorage.getItem('th-dashboard-settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings.maxTurns) return parseInt(settings.maxTurns, 10);
      }
    } catch {
      // Ignore
    }
    return undefined;
  };

  const getSettingsMaxRetries = (): number | undefined => {
    try {
      const raw = localStorage.getItem('th-dashboard-settings');
      if (raw) {
        const settings = JSON.parse(raw);
        if (settings.maxRetriesPerAction) return parseInt(settings.maxRetriesPerAction, 10);
      }
    } catch {
      // Ignore
    }
    return undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    try {
      const maxTurns = getSettingsMaxTurns();
      const maxRetries = getSettingsMaxRetries();
      const id = await createSession(
        url.trim(),
        instructions.trim() || undefined,
        maxTurns,
        maxRetries,
      );
      navigate(`/sessions/${id}`);
    } catch {
      // Error is handled by the store
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">New Test Session</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tell the AI agent what to test — it will plan and execute automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Target URL */}
        <Card>
          <Input
            label="Target URL *"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) clearError();
            }}
            required
            error={error ?? undefined}
          />
        </Card>

        {/* AI Instructions */}
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-slate-100">
            🤖 Test Instructions
          </h2>
          <p className="mb-3 text-sm text-slate-400">
            Describe what you want tested. Include credentials, test cases, focus areas — anything the AI needs to know.
          </p>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={10}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono leading-relaxed"
            placeholder={`Example:

This is a ZenTao project management system.

Login credentials:
- URL: https://example.com/zentao/user-login.html
- Username: admin
- Password: admin123

Test requirements:
1. Test the login page — verify form works
2. Test the dashboard after login — check all modules load
3. Test task creation flow
4. Check password reset functionality

Focus areas: security and functionality.`}
          />
        </Card>

        {/* Submit */}
        <Card>
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!url.trim() || loading}
            >
              {loading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Starting...
                </>
              ) : (
                '🚀 Start Test'
              )}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
};
