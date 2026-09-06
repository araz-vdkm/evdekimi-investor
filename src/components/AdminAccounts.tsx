import React, { useState, useEffect } from 'react';
import { RefreshCcw, AlertTriangle } from 'lucide-react';

type MappingStatus = 'LINKED' | 'NOT_LINKED' | 'ERROR' | 'MAPPING_INCONSISTENT';

interface AccountMappingUser {
  investorName: string;
  investorCode: string;
  legacyUsername: string;
  googleAccount: string | null;
  provider: string | null;
  status: MappingStatus;
  linkedAt: string | null;
  googleEmail: string | null;
}

interface OrphanMapping {
  investorCode: string;
  googleAccount: string;
  provider: string;
  linkedAt: string | null;
  legacyUsername: string | null;
}

interface AccountMappingSummary {
  total: number;
  linked: number;
  notLinked: number;
  mappingIssues: number;
}

function formatLinkedAt(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusLabel(status: MappingStatus) {
  switch (status) {
    case 'LINKED':
      return 'Linked';
    case 'NOT_LINKED':
      return 'Not linked';
    case 'ERROR':
      return 'Error';
    case 'MAPPING_INCONSISTENT':
      return 'Mapping inconsistent';
    default:
      return status;
  }
}

function statusClass(status: MappingStatus) {
  switch (status) {
    case 'LINKED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    case 'NOT_LINKED':
      return 'bg-gray-50 text-brand-muted border-gray-200';
    case 'ERROR':
      return 'bg-red-50 text-red-700 border-red-100';
    case 'MAPPING_INCONSISTENT':
      return 'bg-amber-50 text-amber-700 border-amber-100';
    default:
      return 'bg-gray-50 text-brand-muted border-gray-200';
  }
}

export function AdminAccounts() {
  const [users, setUsers] = useState<AccountMappingUser[]>([]);
  const [orphanMappings, setOrphanMappings] = useState<OrphanMapping[]>([]);
  const [summary, setSummary] = useState<AccountMappingSummary>({ total: 0, linked: 0, notLinked: 0, mappingIssues: 0 });
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [firebaseConfigured, setFirebaseConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const fetchMappings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/account-links', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Admin session expired. Please sign in again to view account mappings.');
        }
        if (res.status === 403) {
          throw new Error('Admin access required. Sign in with an administrator account.');
        }
        throw new Error(data.error || `Failed to load account mappings (${res.status})`);
      }
      const nextUsers = Array.isArray(data.users) ? data.users : [];
      setUsers(nextUsers);
      setOrphanMappings(Array.isArray(data.orphanMappings) ? data.orphanMappings : []);
      setSummary(data.summary || {
        total: nextUsers.length,
        linked: nextUsers.filter((u: AccountMappingUser) => u.status === 'LINKED').length,
        notLinked: nextUsers.filter((u: AccountMappingUser) => u.status === 'NOT_LINKED').length,
        mappingIssues: nextUsers.filter((u: AccountMappingUser) => u.status === 'MAPPING_INCONSISTENT').length
          + (Array.isArray(data.orphanMappings) ? data.orphanMappings.length : 0),
      });
      setFirebaseError(data.firebase?.error || null);
      setFirebaseConfigured(data.firebase?.configured !== false);
    } catch (err: any) {
      setUsers([]);
      setOrphanMappings([]);
      setSummary({ total: 0, linked: 0, notLinked: 0, mappingIssues: 0 });
      setError(err.message || 'Failed to load account mappings');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlink = async (email: string) => {
    const normalized = email.toLowerCase().trim();
    if (!window.confirm(`Unlink Google account ${email}?`)) return;
    setUnlinking(normalized);
    setError(null);
    try {
      const res = await fetch(`/api/admin/account-links/${encodeURIComponent(normalized)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to unlink Google account');
      }
      await fetchMappings();
    } catch (err: any) {
      setError(`Failed to unlink: ${err.message}`);
    } finally {
      setUnlinking(null);
    }
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-brand-navy">Google Account Mapping</h2>
          <p className="text-brand-muted text-sm mt-1">
            Overview of all investors and their Google account authorization status.
          </p>
        </div>
        <button
          onClick={fetchMappings}
          disabled={loading}
          className="flex items-center gap-2 bg-white border border-brand-muted/20 px-4 py-2 rounded-xl text-sm font-bold text-brand-navy hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      {firebaseError && (
        <div className="bg-amber-50 border border-amber-100 text-amber-800 p-4 rounded-xl text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Google mapping data unavailable</p>
            <p className="mt-1">{firebaseError}</p>
            {!firebaseConfigured && (
              <p className="mt-1 text-xs">
                Investors are still listed below. Configure GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY for full mapping status.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-brand-muted/10 p-5">
          <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Total users</p>
          <p className="text-2xl font-bold text-brand-navy mt-1">{summary.total}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-brand-muted/10 p-5">
          <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Google linked</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{summary.linked}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-brand-muted/10 p-5">
          <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Not linked</p>
          <p className="text-2xl font-bold text-brand-navy mt-1">{summary.notLinked}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-brand-muted/10 p-5">
          <p className="text-[10px] font-bold text-brand-muted uppercase tracking-widest">Mapping issues</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{summary.mappingIssues}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-brand-muted/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead>
              <tr className="bg-brand-bg/50">
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Investor</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Legacy ID</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Username</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Google Account</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Provider</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest">Linked At</th>
                <th className="px-6 py-4 text-xs font-bold text-brand-muted uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-muted/10">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-brand-muted text-sm">
                    Loading...
                  </td>
                </tr>
              ) : error && users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-red-600 text-sm font-semibold">
                    Account mappings could not be loaded.
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-brand-muted text-sm">
                    No investors found.
                  </td>
                </tr>
              ) : (
                users.map((user, idx) => (
                  <tr key={`${user.investorCode}-${user.googleEmail || 'none'}-${idx}`} className="hover:bg-brand-bg/30 transition-colors">
                    <td className="px-6 py-4 font-semibold text-brand-navy">{user.investorName}</td>
                    <td className="px-6 py-4 text-brand-muted font-mono text-sm">{user.investorCode}</td>
                    <td className="px-6 py-4 text-brand-navy">{user.legacyUsername}</td>
                    <td className="px-6 py-4 text-brand-navy">{user.googleAccount || '—'}</td>
                    <td className="px-6 py-4 text-brand-muted capitalize">{user.provider || '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${statusClass(user.status)}`}>
                        {statusLabel(user.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-brand-muted">{formatLinkedAt(user.linkedAt)}</td>
                    <td className="px-6 py-4 text-right">
                      {user.status === 'LINKED' && user.googleEmail ? (
                        <button
                          onClick={() => handleUnlink(user.googleEmail!)}
                          disabled={unlinking === user.googleEmail.toLowerCase()}
                          className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {unlinking === user.googleEmail.toLowerCase() ? 'Unlinking...' : 'Unlink Google Account'}
                        </button>
                      ) : (
                        <span className="text-brand-muted text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {orphanMappings.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="font-bold text-amber-900">Orphan Google mappings</h3>
            <p className="text-sm text-amber-800 mt-1">
              These account_links records reference investor codes that do not exist in the Investors sheet.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="border-b border-amber-200">
                  <th className="px-4 py-3 text-xs font-bold text-amber-900 uppercase tracking-widest">Legacy ID</th>
                  <th className="px-4 py-3 text-xs font-bold text-amber-900 uppercase tracking-widest">Google Account</th>
                  <th className="px-4 py-3 text-xs font-bold text-amber-900 uppercase tracking-widest">Provider</th>
                  <th className="px-4 py-3 text-xs font-bold text-amber-900 uppercase tracking-widest">Linked At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-200/60">
                {orphanMappings.map((orphan, idx) => (
                  <tr key={`${orphan.investorCode}-${orphan.googleAccount}-${idx}`}>
                    <td className="px-4 py-3 font-mono text-sm text-amber-900">{orphan.investorCode}</td>
                    <td className="px-4 py-3 text-amber-900">{orphan.googleAccount}</td>
                    <td className="px-4 py-3 text-amber-800 capitalize">{orphan.provider}</td>
                    <td className="px-4 py-3 text-amber-800">{formatLinkedAt(orphan.linkedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
