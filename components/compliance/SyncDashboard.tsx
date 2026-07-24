'use client';

import React from 'react';
import { useState } from 'react';

import { FilingCard } from './FilingCard';
import { normalizeStatus } from '../../modules/compliance/tracker/status.engine';
import type { BusinessProfile, ComplianceResults } from '../../modules/compliance/types';

const bureauLabels: Record<string, string> = {
  irs: 'IRS',
  comptroller: 'Texas Comptroller',
  experian: 'Experian',
  equifax: 'Equifax',
  dnb: 'D&B',
};

type SyncDashboardProps = {
  business: BusinessProfile;
};

export function SyncDashboard({ business }: SyncDashboardProps) {
  const [status, setStatus] = useState<ComplianceResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const runSync = async () => {
    setIsRunning(true);
    setError(null);

    try {
      const res = await fetch('/api/compliance/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(business),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data?.error || `Compliance sync failed (HTTP ${res.status})`);
      }

      setStatus(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance sync failed (network error)');
    } finally {
      setIsRunning(false);
    }
  };

  const normalizedStatus = status ? normalizeStatus(status) : null;

  return (
    <section aria-label="Compliance sync dashboard">
      <h2>Compliance Sync Dashboard</h2>
      <button type="button" onClick={runSync} disabled={isRunning}>
        {isRunning ? 'Running…' : 'Run compliance sync'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {normalizedStatus ? (
        <div>
          {Object.entries(normalizedStatus).map(([bureau, bureauStatus]) => (
            <FilingCard key={bureau} title={bureauLabels[bureau] || bureau} status={bureauStatus} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
