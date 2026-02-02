/**
 * User Management Component
 * 
 * Manage organization members, invitations, and roles.
 * 
 * @module components/admin/UserManagement
 */

import { useState, useEffect } from 'react';
import { useVault } from '../../hooks/useVault';
import { orgsApi, type Membership } from '../../lib/api';
import { grantOrgAccess } from '../../lib/crypto';

const ROLE_LABELS: Record<string, { label: string; description: string }> = {
  admin: { label: 'Admin', description: 'Full access, can manage users' },
  member: { label: 'Member', description: 'Can view and edit passwords' },
  read_only: { label: 'Read Only', description: 'Can only view passwords' },
};

export default function UserManagement() {
  const { currentOrg, getOrgKey } = useVault();
  
  const [members, setMembers] = useState<Membership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);

  useEffect(() => {
    if (!currentOrg) return;
    loadMembers();
  }, [currentOrg]);

  const loadMembers = async () => {
    if (!currentOrg) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await orgsApi.getMembers(currentOrg.id);
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg || !inviteEmail.trim()) return;
    
    setIsInviting(true);
    setError(null);
    
    try {
      const newMember = await orgsApi.inviteUser(currentOrg.id, inviteEmail.trim());
      setMembers((prev) => [...prev, newMember]);
      setInviteEmail('');
      setShowInviteForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setIsInviting(false);
    }
  };

  const handleApprove = async (member: Membership) => {
    if (!currentOrg || !member.userPublicKey) {
      setError('User needs to complete their account setup before they can be approved');
      return;
    }
    
    const orgKey = getOrgKey();
    if (!orgKey) {
      setError('Vault is locked');
      return;
    }
    
    try {
      const encryptedOrgKey = await grantOrgAccess(orgKey, member.userPublicKey);
      await orgsApi.approveUser(currentOrg.id, member.userId, encryptedOrgKey);
      
      setMembers((prev) =>
        prev.map((m) =>
          m.userId === member.userId
            ? { ...m, status: 'active', encryptedOrgKey }
            : m
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve user');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!currentOrg) return;
    
    if (!confirm('Are you sure you want to remove this user from the organization?')) {
      return;
    }
    
    try {
      await orgsApi.removeUser(currentOrg.id, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    }
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'member' | 'read_only') => {
    if (!currentOrg) return;
    
    try {
      await orgsApi.updateRole(currentOrg.id, userId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">Please select an organization first.</p>
      </div>
    );
  }

  const activeMembers = members.filter((m) => m.status === 'active');
  const pendingMembers = members.filter((m) => m.status === 'pending');

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Users</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {activeMembers.length} active member{activeMembers.length !== 1 ? 's' : ''} in {currentOrg.name}
          </p>
        </div>
        <button
          onClick={() => setShowInviteForm(true)}
          className="inline-flex items-center px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-vault-500 dark:focus:ring-offset-gray-900"
          aria-label="Invite new user"
        >
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Invite User
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm flex items-center justify-between" role="alert">
          <span>{error}</span>
          <button 
            onClick={() => setError(null)} 
            className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Invite Form Modal */}
      {showInviteForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="fixed inset-0 bg-black bg-opacity-30 dark:bg-opacity-50" onClick={() => setShowInviteForm(false)} />
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 id="invite-modal-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Invite User</h2>
              <form onSubmit={handleInvite}>
                <label htmlFor="invite-email" className="sr-only">Email address</label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-vault-500"
                  autoFocus
                />
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  They&apos;ll receive an email to set up their account. You&apos;ll need to approve them once they&apos;ve completed setup.
                </p>
                <div className="mt-4 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowInviteForm(false)}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isInviting || !inviteEmail.trim()}
                    className="px-4 py-2 bg-vault-600 text-white rounded-lg hover:bg-vault-700 disabled:opacity-50"
                  >
                    {isInviting ? 'Inviting...' : 'Send Invite'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12">
          <svg className="animate-spin mx-auto h-8 w-8 text-vault-600" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-2 text-gray-500 dark:text-gray-400">Loading members...</p>
        </div>
      )}

      {/* Pending Approvals */}
      {!isLoading && pendingMembers.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Pending Approval ({pendingMembers.length})
          </h2>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl overflow-hidden">
            <ul className="divide-y divide-yellow-200 dark:divide-yellow-800">
              {pendingMembers.map((member) => (
                <li key={member.userId} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.userEmail}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {member.userPublicKey
                        ? 'Ready to approve - user has completed setup'
                        : 'Waiting for user to complete account setup'}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {member.userPublicKey ? (
                      <button
                        onClick={() => handleApprove(member)}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
                        aria-label={`Approve ${member.userEmail}`}
                      >
                        Approve
                      </button>
                    ) : (
                      <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs rounded-full">
                        Pending Setup
                      </span>
                    )}
                    <button
                      onClick={() => handleRemove(member.userId)}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                      aria-label={`Remove ${member.userEmail}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Active Members */}
      {!isLoading && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Active Members ({activeMembers.length})
          </h2>
          
          {activeMembers.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">No active members</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Invite users to start sharing passwords securely
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {activeMembers.map((member) => (
                  <li key={member.userId} className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-vault-100 dark:bg-vault-900 rounded-full flex items-center justify-center">
                        <span className="text-vault-600 dark:text-vault-400 font-semibold">
                          {(member.userName || member.userEmail).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {member.userName || member.userEmail}
                        </p>
                        {member.userName && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{member.userEmail}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <label htmlFor={`role-${member.userId}`} className="sr-only">
                        Role for {member.userEmail}
                      </label>
                      <select
                        id={`role-${member.userId}`}
                        value={member.role}
                        onChange={(e) =>
                          handleRoleChange(member.userId, e.target.value as 'admin' | 'member' | 'read_only')
                        }
                        className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-vault-500"
                      >
                        {Object.entries(ROLE_LABELS).map(([role, info]) => (
                          <option key={role} value={role}>
                            {info.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleRemove(member.userId)}
                        className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm"
                        aria-label={`Remove ${member.userName || member.userEmail}`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Role Descriptions */}
      <div className="mt-8 bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Role Permissions</h3>
        <dl className="space-y-1">
          {Object.entries(ROLE_LABELS).map(([role, info]) => (
            <div key={role} className="flex text-sm">
              <dt className="w-24 font-medium text-gray-700 dark:text-gray-300">{info.label}:</dt>
              <dd className="text-gray-500 dark:text-gray-400">{info.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
