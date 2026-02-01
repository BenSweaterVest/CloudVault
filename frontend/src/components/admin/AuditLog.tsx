/**
 * Audit Log Component
 * 
 * Displays activity logs for governance and compliance.
 */

import { useState, useEffect } from 'react';
import { useVault } from '../../hooks/useVault';
import { auditApi, type AuditLogEntry } from '../../lib/api';

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  LOGIN: { label: 'Login', color: 'bg-blue-100 text-blue-800' },
  VIEW_SECRET: { label: 'Viewed Password', color: 'bg-green-100 text-green-800' },
  CREATE_SECRET: { label: 'Created Password', color: 'bg-purple-100 text-purple-800' },
  UPDATE_SECRET: { label: 'Updated Password', color: 'bg-yellow-100 text-yellow-800' },
  DELETE_SECRET: { label: 'Deleted Password', color: 'bg-red-100 text-red-800' },
  VIEW_SECRET_HISTORY: { label: 'Viewed History', color: 'bg-gray-100 text-gray-800' },
  CREATE_ORG: { label: 'Created Organization', color: 'bg-indigo-100 text-indigo-800' },
  INVITE_USER: { label: 'Invited User', color: 'bg-teal-100 text-teal-800' },
  APPROVE_USER: { label: 'Approved User', color: 'bg-green-100 text-green-800' },
  REMOVE_USER: { label: 'Removed User', color: 'bg-red-100 text-red-800' },
  UPDATE_USER_ROLE: { label: 'Changed Role', color: 'bg-orange-100 text-orange-800' },
  VIEW_AUDIT_LOG: { label: 'Viewed Audit Log', color: 'bg-gray-100 text-gray-800' },
  EXPORT_AUDIT_LOG: { label: 'Exported Audit Log', color: 'bg-gray-100 text-gray-800' },
};

export default function AuditLog() {
  const { currentOrg } = useVault();
  
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [filterAction, setFilterAction] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  
  const pageSize = 25;

  useEffect(() => {
    if (!currentOrg) return;
    
    setIsLoading(true);
    setError(null);
    
    auditApi
      .list(currentOrg.id, {
        limit: pageSize,
        offset: page * pageSize,
        action: filterAction || undefined,
      })
      .then(({ logs, total }) => {
        setLogs(logs);
        setTotal(total);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load audit logs');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [currentOrg, page, filterAction]);

  const handleExport = async () => {
    if (!currentOrg) return;
    
    setIsExporting(true);
    
    try {
      const blob = await auditApi.exportCsv(currentOrg.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentOrg.name}-audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to export audit log');
    } finally {
      setIsExporting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const getActionInfo = (action: string) => {
    return ACTION_LABELS[action] || { label: action, color: 'bg-gray-100 text-gray-800' };
  };

  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Please select an organization first.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} total events in {currentOrg.name}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isExporting ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Exporting...
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <select
          value={filterAction}
          onChange={(e) => {
            setFilterAction(e.target.value);
            setPage(0);
          }}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-vault-500"
        >
          <option value="">All Actions</option>
          <option value="LOGIN">Logins</option>
          <option value="VIEW_SECRET">Password Views</option>
          <option value="CREATE_SECRET">Password Created</option>
          <option value="UPDATE_SECRET">Password Updates</option>
          <option value="DELETE_SECRET">Password Deletions</option>
          <option value="INVITE_USER">User Invites</option>
          <option value="APPROVE_USER">User Approvals</option>
          <option value="REMOVE_USER">User Removals</option>
        </select>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12">
          <svg className="animate-spin mx-auto h-8 w-8 text-vault-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-2 text-gray-500">Loading audit logs...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && logs.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No audit logs</h3>
          <p className="mt-1 text-sm text-gray-500">
            {filterAction ? 'No events match this filter' : 'Activity will appear here once users start using the vault'}
          </p>
        </div>
      )}

      {/* Logs Table */}
      {!isLoading && logs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Action
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Target
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    IP Address
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((log) => {
                  const actionInfo = getActionInfo(log.action);
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(log.timestamp)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{log.userEmail}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${actionInfo.color}`}>
                          {actionInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{log.targetName || '-'}</span>
                        {log.targetType && (
                          <span className="text-xs text-gray-500 ml-1">({log.targetType})</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {log.ipAddress || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-gray-50 px-6 py-3 flex items-center justify-between border-t border-gray-200">
              <div className="text-sm text-gray-500">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of {total} events
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
