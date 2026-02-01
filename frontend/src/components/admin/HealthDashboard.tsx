/**
 * Password Health Dashboard
 * 
 * Shows overview of password security status:
 * - Health score
 * - Expiring passwords
 * - Old passwords needing rotation
 * - Security recommendations
 */

import { useState, useEffect } from 'react';
import { useVault } from '../../hooks/useVault';
import { Skeleton } from '../ui/Skeleton';

interface HealthData {
  healthScore: number;
  totalSecrets: number;
  metrics: {
    expiringSoon: number;
    expired: number;
    oldPasswords: number;
  };
  expiringSecrets: Array<{
    id: string;
    name: string;
    expiresAt: string;
    secretType: string;
    daysUntilExpiry: number;
  }>;
  oldPasswords: Array<{
    id: string;
    name: string;
    lastUpdated: string;
    daysSinceUpdate: number;
  }>;
}

export default function HealthDashboard() {
  const { currentOrg } = useVault();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) return;

    const fetchHealth = async () => {
      setIsLoading(true);
      try {
        const token = localStorage.getItem('cloudvault_token');
        const response = await fetch(`/api/organizations/${currentOrg.id}/health`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch health data');
        }
        
        const data = await response.json();
        setHealth(data);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHealth();
  }, [currentOrg]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-red-700 dark:text-red-300">Error: {error}</p>
      </div>
    );
  }

  if (!health) return null;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-6">
      {/* Health Score */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Password Health Score
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Based on {health.totalSecrets} passwords
            </p>
          </div>
          <div className="text-right">
            <div className={`text-5xl font-bold ${getScoreColor(health.healthScore)}`}>
              {health.healthScore}
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">out of 100</div>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="mt-4 h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${getScoreBgColor(health.healthScore)}`}
            style={{ width: `${health.healthScore}%` }}
          />
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title="Expiring Soon"
          count={health.metrics.expiringSoon}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          color="yellow"
          description="Within 30 days"
        />
        <MetricCard
          title="Expired"
          count={health.metrics.expired}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
          color="red"
          description="Need immediate attention"
        />
        <MetricCard
          title="Old Passwords"
          count={health.metrics.oldPasswords}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          color="orange"
          description="90+ days old"
        />
      </div>

      {/* Expiring Secrets List */}
      {health.expiringSecrets.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Expiring Soon
          </h3>
          <div className="space-y-3">
            {health.expiringSecrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{secret.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expires {new Date(secret.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                    secret.daysUntilExpiry <= 7
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                  }`}
                >
                  {secret.daysUntilExpiry <= 0
                    ? 'Expired'
                    : `${secret.daysUntilExpiry} days left`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Old Passwords List */}
      {health.oldPasswords.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Passwords Needing Rotation
          </h3>
          <div className="space-y-3">
            {health.oldPasswords.map((secret) => (
              <div
                key={secret.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{secret.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Last updated {new Date(secret.lastUpdated).toLocaleDateString()}
                  </p>
                </div>
                <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  {secret.daysSinceUpdate} days old
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Clear Message */}
      {health.healthScore === 100 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
          <svg className="w-12 h-12 mx-auto text-green-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-green-700 dark:text-green-300">
            Excellent Password Health!
          </h3>
          <p className="text-green-600 dark:text-green-400 mt-1">
            All your passwords are up to date and secure.
          </p>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  color: 'yellow' | 'red' | 'orange' | 'green';
  description: string;
}

function MetricCard({ title, count, icon, color, description }: MetricCardProps) {
  const colorClasses = {
    yellow: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>{icon}</div>
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{count}</p>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
        </div>
      </div>
    </div>
  );
}
