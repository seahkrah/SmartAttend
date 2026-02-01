import React from 'react';
import { CheckCircle, XCircle, Clock, User, Building2 } from 'lucide-react';
import axios from 'axios';

interface PendingApproval {
  id: string;
  user: {
    id: string;
    email: string;
    full_name: string;
  };
  requested_role: string;
  school_entity?: {
    id: string;
    name: string;
  };
  corporate_entity?: {
    id: string;
    name: string;
  };
  requested_at: Date;
}

interface AdminApprovalDashboardProps {
  onClose?: () => void;
}

export const AdminApprovalDashboard: React.FC<AdminApprovalDashboardProps> = ({ onClose }) => {
  const [approvals, setApprovals] = React.useState<{
    school?: PendingApproval[];
    corporate?: PendingApproval[];
  }>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState<{ [key: string]: string }>({});
  const [showRejectionModal, setShowRejectionModal] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchPendingApprovals();
  }, []);

  const fetchPendingApprovals = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('accessToken');
      const response = await axios.get('/api/auth/admin/pending-approvals', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setApprovals(response.data.approvals);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch pending approvals');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (approvalId: string) => {
    try {
      setProcessingId(approvalId);
      const token = localStorage.getItem('accessToken');
      await axios.post(
        '/api/auth/admin/approval-action',
        {
          approvalId,
          action: 'approve'
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Remove from list
      if (approvals.school) {
        setApprovals({
          ...approvals,
          school: approvals.school.filter((a) => a.id !== approvalId)
        });
      }
      if (approvals.corporate) {
        setApprovals({
          ...approvals,
          corporate: approvals.corporate.filter((a) => a.id !== approvalId)
        });
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to approve');
    } finally {
      setProcessingId(null);
    }
  };

  const handleRejectSubmit = async (approvalId: string) => {
    try {
      setProcessingId(approvalId);
      const token = localStorage.getItem('accessToken');
      await axios.post(
        '/api/auth/admin/approval-action',
        {
          approvalId,
          action: 'reject',
          rejectionReason: rejectionReason[approvalId]
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Remove from list
      if (approvals.school) {
        setApprovals({
          ...approvals,
          school: approvals.school.filter((a) => a.id !== approvalId)
        });
      }
      if (approvals.corporate) {
        setApprovals({
          ...approvals,
          corporate: approvals.corporate.filter((a) => a.id !== approvalId)
        });
      }

      setShowRejectionModal(null);
      setRejectionReason({});
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to reject');
    } finally {
      setProcessingId(null);
    }
  };

  const totalPending = (approvals.school?.length || 0) + (approvals.corporate?.length || 0);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">
          <div className="inline-block animate-spin">
            <Clock className="w-8 h-8 text-primary-400" />
          </div>
          <p className="text-slate-400 mt-4">Loading pending approvals...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">User Approvals</h1>
          <p className="text-slate-400 mt-1">
            {totalPending} pending approval{totalPending !== 1 ? 's' : ''}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-300 transition"
          >
            ✕
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* School Approvals */}
      {approvals.school && approvals.school.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-primary-400" />
            <h2 className="text-xl font-bold text-white">School Registrations</h2>
          </div>
          <div className="grid gap-4">
            {approvals.school.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                isProcessing={processingId === approval.id}
                onApprove={() => handleApprove(approval.id)}
                onReject={() => setShowRejectionModal(approval.id)}
                showRejectionModal={showRejectionModal === approval.id}
                rejectionReason={rejectionReason[approval.id] || ''}
                onRejectionReasonChange={(reason) => {
                  setRejectionReason({ ...rejectionReason, [approval.id]: reason });
                }}
                onRejectionSubmit={() => handleRejectSubmit(approval.id)}
                onRejectionCancel={() => {
                  setShowRejectionModal(null);
                  setRejectionReason({ ...rejectionReason, [approval.id]: '' });
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Corporate Approvals */}
      {approvals.corporate && approvals.corporate.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-secondary-400" />
            <h2 className="text-xl font-bold text-white">Corporate Registrations</h2>
          </div>
          <div className="grid gap-4">
            {approvals.corporate.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                isProcessing={processingId === approval.id}
                onApprove={() => handleApprove(approval.id)}
                onReject={() => setShowRejectionModal(approval.id)}
                showRejectionModal={showRejectionModal === approval.id}
                rejectionReason={rejectionReason[approval.id] || ''}
                onRejectionReasonChange={(reason) => {
                  setRejectionReason({ ...rejectionReason, [approval.id]: reason });
                }}
                onRejectionSubmit={() => handleRejectSubmit(approval.id)}
                onRejectionCancel={() => {
                  setShowRejectionModal(null);
                  setRejectionReason({ ...rejectionReason, [approval.id]: '' });
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* No Pending Approvals */}
      {totalPending === 0 && (
        <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">All caught up!</h3>
          <p className="text-slate-400">There are no pending approvals at this time.</p>
        </div>
      )}
    </div>
  );
};

interface ApprovalCardProps {
  approval: PendingApproval;
  isProcessing: boolean;
  onApprove: () => void;
  onReject: () => void;
  showRejectionModal: boolean;
  rejectionReason: string;
  onRejectionReasonChange: (reason: string) => void;
  onRejectionSubmit: () => void;
  onRejectionCancel: () => void;
}

const ApprovalCard: React.FC<ApprovalCardProps> = ({
  approval,
  isProcessing,
  onApprove,
  onReject,
  showRejectionModal,
  rejectionReason,
  onRejectionReasonChange,
  onRejectionSubmit,
  onRejectionCancel
}) => {
  const entity = approval.school_entity || approval.corporate_entity;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-start gap-4 flex-1">
          <div className="w-12 h-12 rounded-full bg-primary-500/20 border border-primary-500/50 flex items-center justify-center flex-shrink-0">
            <User className="w-6 h-6 text-primary-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-white">{approval.user.full_name}</h3>
            <p className="text-sm text-slate-400">{approval.user.email}</p>
            <div className="mt-2 flex items-center gap-4">
              <span className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-500/50 rounded text-blue-300 text-sm font-medium capitalize">
                {approval.requested_role}
              </span>
              {entity && (
                <span className="text-sm text-slate-400">
                  {entity.name}
                </span>
              )}
              <span className="text-xs text-slate-500">
                {new Date(approval.requested_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        {!showRejectionModal && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={onApprove}
              disabled={isProcessing}
              className="p-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 hover:bg-green-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Approve"
            >
              <CheckCircle className="w-5 h-5" />
            </button>
            <button
              onClick={onReject}
              disabled={isProcessing}
              className="p-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 hover:bg-red-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
              title="Reject"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Rejection Modal */}
      {showRejectionModal && (
        <div className="border-t border-slate-700 pt-4">
          <p className="text-sm text-slate-300 mb-3">Rejection reason (optional):</p>
          <textarea
            value={rejectionReason}
            onChange={(e) => onRejectionReasonChange(e.target.value)}
            placeholder="Provide a reason for rejection..."
            className="input-field mb-3 min-h-24"
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={onRejectionCancel}
              disabled={isProcessing}
              className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onRejectionSubmit}
              disabled={isProcessing}
              className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 hover:bg-red-500/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 'Processing...' : 'Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
