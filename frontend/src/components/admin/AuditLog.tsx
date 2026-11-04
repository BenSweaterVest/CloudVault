/**
 * Audit log (admins): who did what, when, from where. Filterable and
 * exportable to CSV for board or compliance reporting.
 */

import { useEffect, useState } from 'react';
import { useVault } from '../../hooks/useVault';
import { auditApi, type AuditLogEntry } from '../../lib/api';
import { Alert, Badge, Button, PageHeader, Select, Spinner, errorMessage } from '../ui/kit';
import { useToast } from '../ui/Toast';

type Color = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple';

const ACTIONS: Record<string, { label: string; color: Color }> = {
  LOGIN: { label: 'Signed in', color: 'blue' },
  LOGOUT: { label: 'Signed out', color: 'gray' },
  LOGOUT_ALL: { label: 'Signed out everywhere', color: 'gray' },
  SETUP_KEYS: { label: 'Set up keys', color: 'blue' },
  CHANGE_MASTER_PASSWORD: { label: 'Changed master password', color: 'amber' },
  UPDATE_PROFILE: { label: 'Updated profile', color: 'gray' },
  VIEW_SECRET: { label: 'Viewed item', color: 'green' },
  CREATE_SECRET: { label: 'Created item', color: 'purple' },
  UPDATE_SECRET: { label: 'Updated item', color: 'amber' },
  DELETE_SECRET: { label: 'Deleted item', color: 'red' },
  VIEW_SECRET_HISTORY: { label: 'Viewed history', color: 'gray' },
  IMPORT_SECRETS: { label: 'Imported items', color: 'purple' },
  EXPORT_SECRETS: { label: 'Exported items', color: 'red' },
  CREATE_ORG: { label: 'Created organization', color: 'purple' },
  UPDATE_ORG: { label: 'Renamed organization', color: 'gray' },
  DELETE_ORG: { label: 'Deleted organization', color: 'red' },
  UPDATE_ORG_SETTINGS: { label: 'Changed settings', color: 'amber' },
  ROTATE_ORG_KEY: { label: 'Rotated vault key', color: 'amber' },
  INVITE_USER: { label: 'Invited member', color: 'blue' },
  APPROVE_USER: { label: 'Approved member', color: 'green' },
  REMOVE_USER: { label: 'Removed member', color: 'red' },
  LEAVE_ORG: { label: 'Left organization', color: 'gray' },
  UPDATE_USER_ROLE: { label: 'Changed role', color: 'amber' },
  CREATE_CATEGORY: { label: 'Created category', color: 'gray' },
  UPDATE_CATEGORY: { label: 'Updated category', color: 'gray' },
  DELETE_CATEGORY: { label: 'Deleted category', color: 'gray' },
  CREATE_SHARE_LINK: { label: 'Created share link', color: 'amber' },
  REVOKE_SHARE_LINK: { label: 'Revoked share link', color: 'gray' },
  ACCESS_SHARE_LINK: { label: 'Share link opened', color: 'amber' },
  ADD_EMERGENCY_CONTACT: { label: 'Added emergency contact', color: 'amber' },
  REMOVE_EMERGENCY_CONTACT: { label: 'Removed emergency contact', color: 'gray' },
  EMERGENCY_ACCESS_REQUESTED: { label: 'Emergency access requested', color: 'red' },
  EMERGENCY_ACCESS_APPROVED: { label: 'Emergency access approved', color: 'red' },
  EMERGENCY_ACCESS_DENIED: { label: 'Emergency access denied', color: 'gray' },
  EMERGENCY_ACCESS_GRANTED: { label: 'Emergency access granted', color: 'red' },
  VIEW_AUDIT_LOG: { label: 'Viewed audit log', color: 'gray' },
  EXPORT_AUDIT_LOG: { label: 'Exported audit log', color: 'gray' },
};

const PAGE_SIZE = 25;

function formatTimestamp(ts: string): string {
  return new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`).toLocaleString();
}

export default function AuditLog() {
  const { currentOrg } = useVault();
  const toast = useToast();
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    setLogs(null);
    auditApi
      .list(currentOrg.id, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, action: action || undefined })
      .then((r) => {
        setLogs(r.logs);
        setTotal(r.total);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [currentOrg, page, action]);

  const exportCsv = async () => {
    if (!currentOrg) return;
    setExporting(true);
    try {
      const blob = await auditApi.exportCsv(currentOrg.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentOrg.name}-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Audit log"
        description={`${total} events in ${currentOrg?.name ?? ''}`}
        actions={
          <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        }
      />
      <div className="mb-4 max-w-xs">
        <Select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All actions</option>
          {Object.entries(ACTIONS).map(([value, { label }]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {!logs && !error && <Spinner />}
      {logs && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">IP address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No events
                  </td>
                </tr>
              )}
              {logs.map((log) => {
                const info = ACTIONS[log.action] ?? { label: log.action, color: 'gray' as Color };
                return (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">{formatTimestamp(log.timestamp)}</td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{log.userEmail ?? <span className="text-gray-400">anonymous</span>}</td>
                    <td className="px-4 py-3">
                      <Badge color={info.color}>{info.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{log.targetName ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400" title={log.userAgent ?? undefined}>
                      {log.ipAddress ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
              <span className="text-gray-500">
                Page {page + 1} of {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
