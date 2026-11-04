/**
 * Password health: expiry and age from the server, plus an on-demand
 * weak/reused password check that decrypts everything locally.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useVault } from '../../hooks/useVault';
import { orgSettingsApi, secretsApi, type HealthReport } from '../../lib/api';
import { decryptSecretPayload, sha256Hex } from '../../lib/crypto';
import { assessPassword } from '../../lib/passwords';
import { Alert, Button, Card, PageHeader, Spinner, cx, errorMessage } from '../ui/kit';

interface LocalReport {
  weak: Array<{ id: string; name: string; label: string }>;
  reused: Array<{ names: string[]; ids: string[] }>;
  checked: number;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'red' | 'amber' | 'green' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p
        className={cx(
          'mt-1 text-2xl font-semibold',
          tone === 'red' ? 'text-red-600 dark:text-red-400' : tone === 'amber' ? 'text-amber-600 dark:text-amber-400' : tone === 'green' ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'
        )}
      >
        {value}
      </p>
    </div>
  );
}

export default function HealthDashboard() {
  const { currentOrg, getOrgKey } = useVault();
  const navigate = useNavigate();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalReport | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    orgSettingsApi
      .getHealth(currentOrg.id)
      .then(setReport)
      .catch((err) => setError(errorMessage(err)));
  }, [currentOrg]);

  const scan = async () => {
    const key = getOrgKey();
    if (!currentOrg || !key) return;
    setScanning(true);
    setError(null);
    try {
      const { secrets } = await secretsApi.export(currentOrg.id);
      const weak: LocalReport['weak'] = [];
      const byHash = new Map<string, Array<{ id: string; name: string }>>();
      let checked = 0;
      for (const s of secrets) {
        const payload = await decryptSecretPayload(s, key, currentOrg.id, s.id).catch(() => null);
        if (!payload?.password) continue;
        checked++;
        const strength = assessPassword(payload.password);
        if (strength.score < 2) weak.push({ id: s.id, name: s.name, label: strength.label });
        const h = await sha256Hex(payload.password);
        byHash.set(h, [...(byHash.get(h) ?? []), { id: s.id, name: s.name }]);
      }
      const reused = [...byHash.values()].filter((g) => g.length > 1).map((g) => ({ names: g.map((x) => x.name), ids: g.map((x) => x.id) }));
      setLocal({ weak, reused, checked });
    } catch (err) {
      setError(errorMessage(err, 'Could not run the check'));
    } finally {
      setScanning(false);
    }
  };

  const open = (id: string) => navigate(`/?secret=${id}`);

  return (
    <div className="space-y-6">
      <PageHeader title="Password health" description={currentOrg?.name} />
      {error && <Alert tone="error">{error}</Alert>}

      {!report ? (
        !error && <Spinner />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Health score" value={`${report.healthScore}%`} tone={report.healthScore >= 80 ? 'green' : report.healthScore >= 50 ? 'amber' : 'red'} />
            <Stat label="Expired" value={report.metrics.expired} tone={report.metrics.expired ? 'red' : undefined} />
            <Stat label="Expiring within 30 days" value={report.metrics.expiringSoon} tone={report.metrics.expiringSoon ? 'amber' : undefined} />
            <Stat label="Not changed in 90+ days" value={report.metrics.oldPasswords} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Expiring and expired">
              {report.expiringSecrets.length === 0 ? (
                <p className="text-sm text-gray-500">Nothing is expiring soon.</p>
              ) : (
                <ul className="divide-y divide-gray-200 text-sm dark:divide-gray-700">
                  {report.expiringSecrets.map((s) => (
                    <li key={s.id} className="flex justify-between py-2">
                      <Link to={`/?secret=${s.id}`} className="font-medium text-vault-700 hover:underline dark:text-vault-300">
                        {s.name}
                      </Link>
                      <span className={s.daysUntilExpiry < 0 ? 'text-red-600' : 'text-amber-600'}>
                        {s.daysUntilExpiry < 0 ? `${-s.daysUntilExpiry} days ago` : `in ${s.daysUntilExpiry} days`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Oldest passwords">
              {report.oldPasswords.length === 0 ? (
                <p className="text-sm text-gray-500">Every login was updated in the last 90 days.</p>
              ) : (
                <ul className="divide-y divide-gray-200 text-sm dark:divide-gray-700">
                  {report.oldPasswords.map((s) => (
                    <li key={s.id} className="flex justify-between py-2">
                      <Link to={`/?secret=${s.id}`} className="font-medium text-vault-700 hover:underline dark:text-vault-300">
                        {s.name}
                      </Link>
                      <span className="text-gray-500">{s.daysSinceUpdate} days</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <Card
        title="Weak and reused passwords"
        description="Decrypts every login in this browser to check strength and reuse. Nothing leaves your device; the audit log records it as an export."
        actions={
          <Button variant="secondary" loading={scanning} onClick={() => void scan()}>
            {local ? 'Check again' : 'Run check'}
          </Button>
        }
      >
        {local && (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600 dark:text-gray-400">Checked {local.checked} passwords.</p>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">Weak ({local.weak.length})</h3>
              <ul className="mt-1 space-y-1">
                {local.weak.map((w) => (
                  <li key={w.id}>
                    <button className="text-vault-700 hover:underline dark:text-vault-300" onClick={() => open(w.id)}>
                      {w.name}
                    </button>{' '}
                    <span className="text-gray-500">({w.label.toLowerCase()})</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">Reused ({local.reused.length} groups)</h3>
              <ul className="mt-1 space-y-1">
                {local.reused.map((g, i) => (
                  <li key={i} className="text-gray-700 dark:text-gray-300">
                    Same password: {g.names.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
