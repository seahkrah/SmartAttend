import React from 'react';
import { AppShell } from '../components/shell/AppShell';
import { EmptyState, LoadingState, ErrorState, NoAccessState } from '../components/states/PageStates';
import { ConfirmDialog } from '../components/states/ConfirmDialog';
import { useTheme } from '../theme/ThemeProvider';

/** Dev-only harness: renders the shell and the states kit for visual checking. */
export const ShellPreview: React.FC = () => {
  const { resolved, setPreference } = useTheme();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  return (
    <AppShell
      eyebrow="SEMESTER I · 2026/27 · WEEK 6"
      title="Good morning, Agnes"
      onSearch={() => {}}
      searchPlaceholder="Search students, courses..."
      counts={{ students: 8412, faculty: 612, approvals: 14 }}
      actions={<button className="btn-primary">+ New session</button>}
    >
      <div className="flex gap-2 mb-5">
        <button className="btn-secondary" onClick={() => setPreference(resolved === 'dark' ? 'light' : 'dark')}>
          Toggle theme (now: {resolved})
        </button>
        <button className="btn-danger" onClick={() => setConfirmOpen(true)}>Open confirm</button>
      </div>
      <div className="flex flex-wrap gap-4">
        <EmptyState title="No students yet" description="Import a roster or add the first student to this programme.">
          <button className="btn-primary">Add student</button>
          <button className="btn-secondary">Import CSV</button>
        </EmptyState>
        <LoadingState label="Loading students..." />
        <ErrorState reference="ERR/26/8841" onRetry={() => {}} onReport={() => {}} />
        <NoAccessState description="Finance records are restricted to the bursar role at this institution." onRequestAccess={() => {}} />
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this section?"
        consequence="CSC 2104 Section 2 has 47 enrolled students and 14 recorded sessions. Attendance history will be archived, not deleted."
        confirmWord="DELETE"
        confirmLabel="Delete section"
        onConfirm={() => setConfirmOpen(false)}
        onCancel={() => setConfirmOpen(false)}
      />
    </AppShell>
  );
};
