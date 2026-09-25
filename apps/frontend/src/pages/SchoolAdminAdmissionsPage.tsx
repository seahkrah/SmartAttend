import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, X, ClipboardCheck, UserPlus, CalendarRange,
  CheckCircle2, Clock, FileText, History, GraduationCap,
} from 'lucide-react';
import { useToastStore } from '../components/Toast';
import { useConfirmDialog } from '../components/useConfirmDialog';
import { getErrorMessage } from '../utils/errorHandler';
import { LoadingOverlay } from '../components/LoadingStates';
import { EmptyState, NoResults } from '../components/ErrorDisplay';
import {
  admissionsService,
  type AdmissionIntake,
  type Applicant,
  type Application,
  type ApplicationDetail,
  type ApplicationEvent,
  type ApplicationStatus,
  type AdmissionsOverview,
  type IntakeFunnel,
} from '../services/admissionsService';
import { academicsService, type Programme, type AcademicYear } from '../services/academicsService';
import FileUpload from '../components/FileUpload';
import { filesService, type StoredFile } from '../services/filesService';

/**
 * Admissions.
 *
 * Three things happen on this page, in the order a registry does them: an
 * intake is opened, applicants and their applications arrive into it, and
 * each application is walked through review to a decision and — when the
 * offer is accepted — to enrolment, at which point a student exists.
 *
 * The status buttons offered on an application come from the server's
 * allowedTransitions rather than from a list held here, so the UI cannot
 * offer a move the state machine would refuse.
 */

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  draft: 'bg-slate-700/60 text-slate-300',
  submitted: 'bg-blue-500/15 text-blue-300',
  under_review: 'bg-indigo-500/15 text-indigo-300',
  offer: 'bg-amber-500/15 text-amber-300',
  accepted: 'bg-emerald-500/15 text-emerald-300',
  enrolled: 'bg-emerald-500/25 text-emerald-200',
  waitlisted: 'bg-violet-500/15 text-violet-300',
  declined: 'bg-slate-600/50 text-slate-400',
  rejected: 'bg-rose-500/15 text-rose-300',
  withdrawn: 'bg-slate-600/50 text-slate-400',
};

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  offer: 'Offer made',
  accepted: 'Offer accepted',
  enrolled: 'Enrolled',
  waitlisted: 'Waitlisted',
  declined: 'Offer declined',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

const StatusChip: React.FC<{ status: ApplicationStatus }> = ({ status }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
    {STATUS_LABEL[status]}
  </span>
);

const today = () => new Date().toISOString().slice(0, 10);

const SchoolAdminAdmissionsPage: React.FC = () => {
  const [tab, setTab] = useState<'applications' | 'intakes' | 'applicants'>('applications');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [overview, setOverview] = useState<AdmissionsOverview | null>(null);
  const [intakes, setIntakes] = useState<AdmissionIntake[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);

  const [search, setSearch] = useState('');
  const [intakeFilter, setIntakeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | ApplicationStatus>('');

  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [funnel, setFunnel] = useState<IntakeFunnel | null>(null);

  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [showApplicantForm, setShowApplicantForm] = useState(false);
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [decision, setDecision] = useState<{ to: ApplicationStatus } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [docForm, setDocForm] = useState({ kind: 'transcript', label: '' });

  const { addToast } = useToastStore();
  const { showConfirmDialog, ConfirmDialog } = useConfirmDialog();

  const [intakeForm, setIntakeForm] = useState({
    code: '', name: '', opensAt: today(), closesAt: '', decisionBy: '',
    capacity: '', academicYearId: '', status: 'draft' as AdmissionIntake['status'],
  });

  const [applicantForm, setApplicantForm] = useState({
    firstName: '', middleName: '', lastName: '', email: '', phone: '',
    dateOfBirth: '', gender: '', nationality: '', priorSchool: '', priorQualification: '',
  });

  const [applicationForm, setApplicationForm] = useState({
    applicantId: '', intakeId: '', programmeId: '', submit: true,
  });

  const [decisionForm, setDecisionForm] = useState({
    note: '', offeredProgrammeId: '', offerExpiresAt: '',
  });

  const [enrolForm, setEnrolForm] = useState({
    studentId: '', programmeId: '', academicYearId: '', entryYear: String(new Date().getFullYear()),
  });

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    void loadApplications();
    // Filters are applied server-side so that another school's rows are never
    // fetched and filtered away in the browser.
  }, [intakeFilter, statusFilter]);

  const load = async () => {
    try {
      setLoading(true);
      const [ov, intakeList, applicantList, programmeList, yearList] = await Promise.all([
        admissionsService.overview(),
        admissionsService.listIntakes(),
        admissionsService.listApplicants(),
        academicsService.listProgrammes().catch(() => [] as Programme[]),
        academicsService.listYears().catch(() => [] as AcademicYear[]),
      ]);
      setOverview(ov);
      setIntakes(intakeList);
      setApplicants(applicantList);
      setProgrammes(programmeList);
      setYears(yearList);
      await loadApplications();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load admissions', message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  };

  const loadApplications = async () => {
    try {
      const list = await admissionsService.listApplications({
        intakeId: intakeFilter || undefined,
        status: statusFilter || undefined,
      });
      setApplications(list);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load applications', message: getErrorMessage(error) });
    }
  };

  const refreshCounts = async () => {
    try {
      setOverview(await admissionsService.overview());
      setIntakes(await admissionsService.listIntakes());
    } catch {
      // The counts are a convenience; a stale header is not worth an error.
    }
  };

  const openApplication = async (id: string) => {
    try {
      setDetailLoading(true);
      const [d, e] = await Promise.all([
        admissionsService.getApplication(id),
        admissionsService.events(id).catch(() => [] as ApplicationEvent[]),
      ]);
      setDetail(d);
      setEvents(e);
      setDecisionForm({
        note: '',
        offeredProgrammeId: d.application.offered_programme_id ?? '',
        offerExpiresAt: '',
      });
      setEnrolForm((prev) => ({
        ...prev,
        programmeId: d.application.offered_programme_id ?? '',
      }));
    } catch (error) {
      addToast({ type: 'error', title: 'Could not open application', message: getErrorMessage(error) });
    } finally {
      setDetailLoading(false);
    }
  };

  const createIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intakeForm.code || !intakeForm.name || !intakeForm.closesAt) return;
    try {
      setSaving(true);
      const created = await admissionsService.createIntake({
        code: intakeForm.code,
        name: intakeForm.name,
        opensAt: intakeForm.opensAt,
        closesAt: intakeForm.closesAt,
        decisionBy: intakeForm.decisionBy || undefined,
        capacity: intakeForm.capacity ? Number(intakeForm.capacity) : undefined,
        academicYearId: intakeForm.academicYearId || undefined,
        status: intakeForm.status,
      });
      setIntakes((prev) => [created, ...prev]);
      setShowIntakeForm(false);
      setIntakeForm({
        code: '', name: '', opensAt: today(), closesAt: '', decisionBy: '',
        capacity: '', academicYearId: '', status: 'draft',
      });
      addToast({ type: 'success', title: 'Intake created' });
      void refreshCounts();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create intake', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const setIntakeStatus = async (intake: AdmissionIntake, status: AdmissionIntake['status']) => {
    try {
      const updated = await admissionsService.updateIntake(intake.id, { status });
      setIntakes((prev) => prev.map((i) => (i.id === intake.id ? { ...i, ...updated } : i)));
      addToast({ type: 'success', title: `Intake ${status}` });
      void refreshCounts();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not update intake', message: getErrorMessage(error) });
    }
  };

  const removeIntake = async (intake: AdmissionIntake) => {
    const confirmed = await showConfirmDialog({
      title: 'Delete intake',
      message: `Delete "${intake.name}"? An intake that already has applications cannot be deleted — archive it instead.`,
      confirmText: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await admissionsService.deleteIntake(intake.id);
      setIntakes((prev) => prev.filter((i) => i.id !== intake.id));
      addToast({ type: 'success', title: 'Intake deleted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not delete intake', message: getErrorMessage(error) });
    }
  };

  const showFunnel = async (intake: AdmissionIntake) => {
    try {
      const { funnel: f } = await admissionsService.intakeFunnel(intake.id);
      setFunnel(f);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not load the funnel', message: getErrorMessage(error) });
    }
  };

  const createApplicant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicantForm.firstName || !applicantForm.lastName || !applicantForm.email) return;
    try {
      setSaving(true);
      const created = await admissionsService.createApplicant({
        firstName: applicantForm.firstName,
        middleName: applicantForm.middleName || undefined,
        lastName: applicantForm.lastName,
        email: applicantForm.email,
        phone: applicantForm.phone || undefined,
        dateOfBirth: applicantForm.dateOfBirth || undefined,
        gender: applicantForm.gender || undefined,
        nationality: applicantForm.nationality || undefined,
        priorSchool: applicantForm.priorSchool || undefined,
        priorQualification: applicantForm.priorQualification || undefined,
      });
      setApplicants((prev) => [created, ...prev]);
      setShowApplicantForm(false);
      setApplicantForm({
        firstName: '', middleName: '', lastName: '', email: '', phone: '',
        dateOfBirth: '', gender: '', nationality: '', priorSchool: '', priorQualification: '',
      });
      addToast({ type: 'success', title: 'Applicant registered', message: `Reference ${created.reference}` });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not register applicant', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const createApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicationForm.applicantId || !applicationForm.intakeId) return;
    try {
      setSaving(true);
      await admissionsService.createApplication({
        applicantId: applicationForm.applicantId,
        intakeId: applicationForm.intakeId,
        submit: applicationForm.submit,
        choices: applicationForm.programmeId
          ? [{ programmeId: applicationForm.programmeId, rank: 1 }]
          : undefined,
      });
      setShowApplicationForm(false);
      setApplicationForm({ applicantId: '', intakeId: '', programmeId: '', submit: true });
      addToast({ type: 'success', title: 'Application started' });
      await loadApplications();
      void refreshCounts();
    } catch (error) {
      addToast({ type: 'error', title: 'Could not start application', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const applyTransition = async (to: ApplicationStatus, force = false) => {
    if (!detail) return;
    try {
      setSaving(true);
      await admissionsService.transition(detail.application.id, {
        to,
        note: decisionForm.note || undefined,
        offeredProgrammeId: to === 'offer' ? decisionForm.offeredProgrammeId || undefined : undefined,
        offerExpiresAt: to === 'offer' ? decisionForm.offerExpiresAt || undefined : undefined,
        force: force || undefined,
      });
      setDecision(null);
      await openApplication(detail.application.id);
      await loadApplications();
      void refreshCounts();
      addToast({ type: 'success', title: STATUS_LABEL[to] });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not update the application', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const enrol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      setSaving(true);
      const result = await admissionsService.enrol(detail.application.id, {
        studentId: enrolForm.studentId || undefined,
        programmeId: enrolForm.programmeId || undefined,
        academicYearId: enrolForm.academicYearId || undefined,
        entryYear: enrolForm.entryYear ? Number(enrolForm.entryYear) : undefined,
      });
      setEnrolling(false);
      await openApplication(detail.application.id);
      await loadApplications();
      void refreshCounts();
      // The password is shown once and never retrievable afterwards, so it
      // needs to stay on screen until the registrar dismisses it.
      addToast({
        type: 'success',
        title: `Enrolled as ${result.student.studentId}`,
        message: `One-time password: ${result.temporaryPassword} — the student must change it on first login.`,
        duration: null,
      });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not enrol', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Attaches an uploaded file to the application as a document.
   *
   * The file is uploaded first and the record created from its id; the server
   * derives the URL. Nothing here types a URL, which is what the field used
   * to be — free text a caller could point anywhere.
   */
  const attachDocument = async (stored: StoredFile) => {
    if (!detail) return;
    try {
      setSaving(true);
      await admissionsService.addDocument(detail.application.id, {
        kind: docForm.kind || 'other',
        label: docForm.label || stored.name,
        fileId: stored.id,
      });
      setDocForm({ kind: 'transcript', label: '' });
      await openApplication(detail.application.id);
      addToast({ type: 'success', title: 'Document attached' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not attach it', message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const setDocumentStatus = async (
    documentId: string,
    status: 'received' | 'verified' | 'rejected'
  ) => {
    if (!detail) return;
    try {
      await admissionsService.updateDocument(detail.application.id, documentId, { status });
      await openApplication(detail.application.id);
      addToast({ type: 'success', title: `Document ${status}` });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not update it', message: getErrorMessage(error) });
    }
  };

  const downloadDocument = async (fileId: string, name: string) => {
    try {
      await filesService.download({ id: fileId, name } as StoredFile);
    } catch (error) {
      addToast({ type: 'error', title: 'Could not download', message: getErrorMessage(error) });
    }
  };

  const filteredApplications = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return applications;
    return applications.filter((a) =>
      `${a.first_name ?? ''} ${a.last_name ?? ''} ${a.email ?? ''} ${a.reference}`
        .toLowerCase()
        .includes(term)
    );
  }, [applications, search]);

  const filteredApplicants = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return applicants;
    return applicants.filter((a) =>
      `${a.first_name} ${a.last_name} ${a.email} ${a.reference}`.toLowerCase().includes(term)
    );
  }, [applicants, search]);

  const openIntakes = useMemo(() => intakes.filter((i) => i.status === 'open'), [intakes]);

  if (loading) {
    return (
      <>
        <LoadingOverlay message="Loading admissions…" />
      </>
    );
  }

  return (
    <>
      <ConfirmDialog />

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Admissions</h1>
          <p className="text-sm text-slate-400 mt-1">
            From an enquiry to an enrolled student, with every decision on the record.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowApplicantForm(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            <UserPlus className="h-4 w-4" />
            New applicant
          </button>
          <button
            onClick={() => setShowApplicationForm(true)}
            disabled={applicants.length === 0 || openIntakes.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            New application
          </button>
        </div>
      </div>

      {overview && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {[
            { label: 'Applications', value: overview.total, icon: ClipboardCheck },
            { label: 'Awaiting a decision', value: overview.awaitingDecision, icon: Clock },
            { label: 'Offers outstanding', value: overview.offersOutstanding, icon: FileText },
            { label: 'Ready to enrol', value: overview.readyToEnrol, icon: GraduationCap },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{card.label}</p>
                <card.icon className="h-4 w-4 text-slate-500" />
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-100">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        {(['applications', 'intakes', 'applicants'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
              tab === t ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or reference"
            className="w-72 rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* ------------------------------------------------------ applications */}
      {tab === 'applications' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <select
                value={intakeFilter}
                onChange={(e) => setIntakeFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                <option value="">All intakes</option>
                {intakes.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as '' | ApplicationStatus)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                <option value="">Any status</option>
                {(Object.keys(STATUS_LABEL) as ApplicationStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>

            {applications.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck className="h-8 w-8" />}
                title="No applications yet"
                message="Open an intake and register an applicant to start taking applications."
              />
            ) : filteredApplications.length === 0 ? (
              <NoResults searchTerm={search} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-800">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Applicant</th>
                      <th className="px-4 py-3">Intake</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredApplications.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => void openApplication(a.id)}
                        className={`cursor-pointer hover:bg-slate-800/60 ${
                          detail?.application.id === a.id ? 'bg-slate-800/80' : ''
                        }`}
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-200">
                            {a.first_name} {a.last_name}
                          </p>
                          <p className="text-xs text-slate-500">{a.email}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{a.intake_name}</td>
                        <td className="px-4 py-3"><StatusChip status={a.status} /></td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{a.reference}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside>
            {detailLoading ? (
              <div className="rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-400">
                Loading…
              </div>
            ) : !detail ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
                Select an application to review it.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-100">
                        {detail.application.first_name} {detail.application.last_name}
                      </h2>
                      <p className="text-xs text-slate-500">{detail.application.email}</p>
                    </div>
                    <StatusChip status={detail.application.status} />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500">Intake</dt>
                      <dd className="text-slate-300">{detail.application.intake_name}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Reference</dt>
                      <dd className="font-mono text-slate-300">{detail.application.reference}</dd>
                    </div>
                    {detail.application.prior_school && (
                      <div>
                        <dt className="text-slate-500">Prior school</dt>
                        <dd className="text-slate-300">{detail.application.prior_school}</dd>
                      </div>
                    )}
                    {detail.application.offered_programme_name && (
                      <div>
                        <dt className="text-slate-500">Offered</dt>
                        <dd className="text-slate-300">{detail.application.offered_programme_name}</dd>
                      </div>
                    )}
                    {detail.application.student_number && (
                      <div>
                        <dt className="text-slate-500">Student number</dt>
                        <dd className="font-mono text-emerald-300">{detail.application.student_number}</dd>
                      </div>
                    )}
                    {detail.application.reviewed_by_name && (
                      <div>
                        <dt className="text-slate-500">Last decided by</dt>
                        <dd className="text-slate-300">{detail.application.reviewed_by_name}</dd>
                      </div>
                    )}
                  </dl>

                  {detail.choices.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Programme choices</p>
                      <ol className="mt-1 space-y-1 text-sm text-slate-300">
                        {detail.choices.map((c) => (
                          <li key={c.id}>
                            {c.preference_rank}. {c.programme_name}{' '}
                            <span className="text-xs text-slate-500">({c.programme_code})</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="mt-4 border-t border-slate-800 pt-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Documents</p>

                    {detail.documents.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {detail.documents.map((doc) => (
                          <li
                            key={doc.id}
                            className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm text-slate-200">{doc.label}</p>
                                <p className="text-xs text-slate-500">
                                  {doc.kind}
                                  {doc.is_required ? ' · required' : ' · optional'}
                                </p>
                              </div>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                                doc.status === 'verified' ? 'bg-emerald-500/15 text-emerald-300'
                                : doc.status === 'rejected' ? 'bg-rose-500/15 text-rose-300'
                                : doc.status === 'received' ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-slate-700/60 text-slate-400'
                              }`}>
                                {doc.status}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {doc.file_id && (
                                <button
                                  onClick={() => void downloadDocument(doc.file_id!, doc.label)}
                                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                                >
                                  Download
                                </button>
                              )}
                              {doc.status !== 'verified' && doc.file_id && (
                                <button
                                  onClick={() => void setDocumentStatus(doc.id, 'verified')}
                                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-emerald-300 hover:bg-slate-800"
                                >
                                  Verify
                                </button>
                              )}
                              {doc.status !== 'rejected' && doc.file_id && (
                                <button
                                  onClick={() => void setDocumentStatus(doc.id, 'rejected')}
                                  className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-rose-300 hover:bg-slate-800"
                                >
                                  Reject
                                </button>
                              )}
                              {!doc.file_id && (
                                <span className="text-xs text-slate-500">
                                  Nothing uploaded yet
                                </span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No documents on this application yet.
                      </p>
                    )}

                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={docForm.kind}
                          onChange={(e) => setDocForm({ ...docForm, kind: e.target.value })}
                          className={inputClass}
                        >
                          <option value="transcript">Transcript</option>
                          <option value="certificate">Certificate</option>
                          <option value="identity">Identity document</option>
                          <option value="reference">Reference</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          value={docForm.label}
                          onChange={(e) => setDocForm({ ...docForm, label: e.target.value })}
                          placeholder="Label (optional)"
                          className={inputClass}
                        />
                      </div>
                      <FileUpload
                        category="application_document"
                        ownerType="application"
                        ownerId={detail.application.id}
                        label="Attach a document"
                        onUploaded={(stored) => void attachDocument(stored)}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  {/* The server says what is possible; nothing else is offered. */}
                  {detail.allowedTransitions.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {detail.allowedTransitions.map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setDecisionForm({
                              note: '',
                              offeredProgrammeId:
                                detail.application.offered_programme_id
                                ?? detail.choices[0]?.programme_id
                                ?? '',
                              offerExpiresAt: '',
                            });
                            setDecision({ to: t });
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                        >
                          {STATUS_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  )}

                  {detail.application.status === 'accepted' && (
                    <button
                      onClick={() => setEnrolling(true)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                    >
                      <GraduationCap className="h-4 w-4" />
                      Enrol as a student
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    <History className="h-3.5 w-3.5" />
                    History
                  </p>
                  <ol className="mt-3 space-y-3">
                    {events.map((e) => (
                      <li key={e.id} className="border-l border-slate-700 pl-3">
                        <p className="text-sm text-slate-200">
                          {e.from_status ? `${STATUS_LABEL[e.from_status]} → ` : ''}
                          {STATUS_LABEL[e.to_status]}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(e.occurred_at).toLocaleString()}
                          {e.actor_name ? ` · ${e.actor_name}` : ''}
                        </p>
                        {e.note && <p className="mt-1 text-xs text-slate-400">{e.note}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ----------------------------------------------------------- intakes */}
      {tab === 'intakes' && (
        <div>
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => setShowIntakeForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
            >
              <Plus className="h-4 w-4" />
              New intake
            </button>
          </div>

          {intakes.length === 0 ? (
            <EmptyState
              icon={<CalendarRange className="h-8 w-8" />}
              title="No intakes yet"
              message="An intake is an admissions cycle — September entry, January entry. Applications arrive into one."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {intakes.map((i) => (
                <div key={i.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-100">{i.name}</h3>
                      <p className="font-mono text-xs text-slate-500">{i.code}</p>
                    </div>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs capitalize text-slate-300">
                      {i.status}
                    </span>
                  </div>

                  <p className="mt-3 text-xs text-slate-400">
                    {new Date(i.opens_at).toLocaleDateString()} –{' '}
                    {new Date(i.closes_at).toLocaleDateString()}
                  </p>

                  <div className="mt-3 flex gap-4 text-sm">
                    <span className="text-slate-300">
                      {i.application_count ?? 0} application{(i.application_count ?? 0) === 1 ? '' : 's'}
                    </span>
                    {i.capacity != null && (
                      <span className="text-slate-400">
                        {i.places_taken ?? 0}/{i.capacity} places
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {i.status !== 'open' && (
                      <button
                        onClick={() => void setIntakeStatus(i, 'open')}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-emerald-300 hover:bg-slate-800"
                      >
                        Open
                      </button>
                    )}
                    {i.status === 'open' && (
                      <button
                        onClick={() => void setIntakeStatus(i, 'closed')}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-amber-300 hover:bg-slate-800"
                      >
                        Close
                      </button>
                    )}
                    {i.status !== 'archived' && (
                      <button
                        onClick={() => void setIntakeStatus(i, 'archived')}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      >
                        Archive
                      </button>
                    )}
                    <button
                      onClick={() => void showFunnel(i)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Funnel
                    </button>
                    <button
                      onClick={() => void removeIntake(i)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-rose-300 hover:bg-slate-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- applicants */}
      {tab === 'applicants' && (
        <div>
          {applicants.length === 0 ? (
            <EmptyState
              icon={<UserPlus className="h-8 w-8" />}
              title="No applicants yet"
              message="Register someone who has enquired; they become a student only once an offer is accepted."
            />
          ) : filteredApplicants.length === 0 ? (
            <NoResults searchTerm={search} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Applications</th>
                    <th className="px-4 py-3">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredApplicants.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 text-slate-200">{a.first_name} {a.last_name}</td>
                      <td className="px-4 py-3 text-slate-400">{a.email}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{a.reference}</td>
                      <td className="px-4 py-3 text-slate-300">{a.application_count ?? 0}</td>
                      <td className="px-4 py-3">
                        {a.converted_student_id ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Enrolled
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">In progress</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- modals */}
      {showIntakeForm && (
        <Modal title="New intake" onClose={() => setShowIntakeForm(false)}>
          <form onSubmit={createIntake} className="space-y-3">
            <Field label="Code">
              <input required value={intakeForm.code}
                onChange={(e) => setIntakeForm({ ...intakeForm, code: e.target.value })}
                placeholder="SEP-2026" className={inputClass} />
            </Field>
            <Field label="Name">
              <input required value={intakeForm.name}
                onChange={(e) => setIntakeForm({ ...intakeForm, name: e.target.value })}
                placeholder="September 2026 entry" className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Opens">
                <input required type="date" value={intakeForm.opensAt}
                  onChange={(e) => setIntakeForm({ ...intakeForm, opensAt: e.target.value })}
                  className={inputClass} />
              </Field>
              <Field label="Closes">
                <input required type="date" value={intakeForm.closesAt}
                  onChange={(e) => setIntakeForm({ ...intakeForm, closesAt: e.target.value })}
                  className={inputClass} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Decisions by (optional)">
                <input type="date" value={intakeForm.decisionBy}
                  onChange={(e) => setIntakeForm({ ...intakeForm, decisionBy: e.target.value })}
                  className={inputClass} />
              </Field>
              <Field label="Places (optional)">
                <input type="number" min="1" value={intakeForm.capacity}
                  onChange={(e) => setIntakeForm({ ...intakeForm, capacity: e.target.value })}
                  className={inputClass} />
              </Field>
            </div>
            <Field label="Academic year (optional)">
              <select value={intakeForm.academicYearId}
                onChange={(e) => setIntakeForm({ ...intakeForm, academicYearId: e.target.value })}
                className={inputClass}>
                <option value="">Not linked</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={intakeForm.status}
                onChange={(e) => setIntakeForm({ ...intakeForm, status: e.target.value as AdmissionIntake['status'] })}
                className={inputClass}>
                <option value="draft">Draft</option>
                <option value="open">Open</option>
              </select>
            </Field>
            <FormActions saving={saving} onCancel={() => setShowIntakeForm(false)} submitLabel="Create intake" />
          </form>
        </Modal>
      )}

      {showApplicantForm && (
        <Modal title="Register an applicant" onClose={() => setShowApplicantForm(false)}>
          <form onSubmit={createApplicant} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input required value={applicantForm.firstName}
                  onChange={(e) => setApplicantForm({ ...applicantForm, firstName: e.target.value })}
                  className={inputClass} />
              </Field>
              <Field label="Last name">
                <input required value={applicantForm.lastName}
                  onChange={(e) => setApplicantForm({ ...applicantForm, lastName: e.target.value })}
                  className={inputClass} />
              </Field>
            </div>
            <Field label="Email">
              <input required type="email" value={applicantForm.email}
                onChange={(e) => setApplicantForm({ ...applicantForm, email: e.target.value })}
                className={inputClass} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone">
                <input value={applicantForm.phone}
                  onChange={(e) => setApplicantForm({ ...applicantForm, phone: e.target.value })}
                  className={inputClass} />
              </Field>
              <Field label="Date of birth">
                <input type="date" value={applicantForm.dateOfBirth}
                  onChange={(e) => setApplicantForm({ ...applicantForm, dateOfBirth: e.target.value })}
                  className={inputClass} />
              </Field>
            </div>
            <Field label="Prior school">
              <input value={applicantForm.priorSchool}
                onChange={(e) => setApplicantForm({ ...applicantForm, priorSchool: e.target.value })}
                className={inputClass} />
            </Field>
            <Field label="Prior qualification">
              <input value={applicantForm.priorQualification}
                onChange={(e) => setApplicantForm({ ...applicantForm, priorQualification: e.target.value })}
                className={inputClass} />
            </Field>
            <FormActions saving={saving} onCancel={() => setShowApplicantForm(false)} submitLabel="Register" />
          </form>
        </Modal>
      )}

      {showApplicationForm && (
        <Modal title="New application" onClose={() => setShowApplicationForm(false)}>
          <form onSubmit={createApplication} className="space-y-3">
            <Field label="Applicant">
              <select required value={applicationForm.applicantId}
                onChange={(e) => setApplicationForm({ ...applicationForm, applicantId: e.target.value })}
                className={inputClass}>
                <option value="">Choose an applicant</option>
                {applicants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.first_name} {a.last_name} — {a.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Intake">
              <select required value={applicationForm.intakeId}
                onChange={(e) => setApplicationForm({ ...applicationForm, intakeId: e.target.value })}
                className={inputClass}>
                <option value="">Choose an intake</option>
                {openIntakes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <Field label="First programme choice (optional)">
              <select value={applicationForm.programmeId}
                onChange={(e) => setApplicationForm({ ...applicationForm, programmeId: e.target.value })}
                className={inputClass}>
                <option value="">Not stated</option>
                {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={applicationForm.submit}
                onChange={(e) => setApplicationForm({ ...applicationForm, submit: e.target.checked })} />
              Submit it now rather than saving a draft
            </label>
            <FormActions saving={saving} onCancel={() => setShowApplicationForm(false)} submitLabel="Start application" />
          </form>
        </Modal>
      )}

      {decision && detail && (
        <Modal title={STATUS_LABEL[decision.to]} onClose={() => setDecision(null)}>
          <div className="space-y-3">
            {decision.to === 'offer' && (
              <>
                <Field label="Programme offered">
                  <select value={decisionForm.offeredProgrammeId}
                    onChange={(e) => setDecisionForm({ ...decisionForm, offeredProgrammeId: e.target.value })}
                    className={inputClass}>
                    <option value="">Choose a programme</option>
                    {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Offer expires (optional)">
                  <input type="date" value={decisionForm.offerExpiresAt}
                    onChange={(e) => setDecisionForm({ ...decisionForm, offerExpiresAt: e.target.value })}
                    className={inputClass} />
                </Field>
              </>
            )}
            <Field label="Note (kept on the record)">
              <textarea rows={3} value={decisionForm.note}
                onChange={(e) => setDecisionForm({ ...decisionForm, note: e.target.value })}
                className={inputClass} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDecision(null)}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
                Cancel
              </button>
              <button
                onClick={() => void applyTransition(decision.to)}
                disabled={saving || (decision.to === 'offer' && !decisionForm.offeredProgrammeId)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40"
              >
                {saving ? 'Saving…' : STATUS_LABEL[decision.to]}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {enrolling && detail && (
        <Modal title="Enrol as a student" onClose={() => setEnrolling(false)}>
          <form onSubmit={enrol} className="space-y-3">
            <p className="text-sm text-slate-400">
              This creates the login, the student record and the programme enrolment for{' '}
              <span className="text-slate-200">
                {detail.application.first_name} {detail.application.last_name}
              </span>. The one-time password is shown once, here.
            </p>
            <Field label="Student number (left blank, one is allocated)">
              <input value={enrolForm.studentId}
                onChange={(e) => setEnrolForm({ ...enrolForm, studentId: e.target.value })}
                className={inputClass} />
            </Field>
            <Field label="Programme">
              <select value={enrolForm.programmeId}
                onChange={(e) => setEnrolForm({ ...enrolForm, programmeId: e.target.value })}
                className={inputClass}>
                <option value="">The programme offered</option>
                {programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Academic year">
                <select value={enrolForm.academicYearId}
                  onChange={(e) => setEnrolForm({ ...enrolForm, academicYearId: e.target.value })}
                  className={inputClass}>
                  <option value="">Not stated</option>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </select>
              </Field>
              <Field label="Entry year">
                <input type="number" value={enrolForm.entryYear}
                  onChange={(e) => setEnrolForm({ ...enrolForm, entryYear: e.target.value })}
                  className={inputClass} />
              </Field>
            </div>
            <FormActions saving={saving} onCancel={() => setEnrolling(false)} submitLabel="Enrol" />
          </form>
        </Modal>
      )}

      {funnel && (
        <Modal title="Admissions funnel" onClose={() => setFunnel(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Applications', funnel.total],
              ['Submitted', funnel.submitted],
              ['Offers made', funnel.offers],
              ['Offers accepted', funnel.accepted],
              ['Enrolled', funnel.enrolled],
              ['Rejected', funnel.rejected],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-slate-800 p-3">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="text-lg font-semibold text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            {[
              ['Offer rate', funnel.offerRate],
              ['Acceptance', funnel.acceptanceRate],
              ['Yield', funnel.yieldRate],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-slate-800 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                {/* A null rate means nothing to divide by, which is not 0%. */}
                <p className="text-lg font-semibold text-slate-100">
                  {value === null || value === undefined ? '—' : `${value}%`}
                </p>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
};

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
    {children}
  </label>
);

const FormActions: React.FC<{ saving: boolean; onCancel: () => void; submitLabel: string }> = ({
  saving, onCancel, submitLabel,
}) => (
  <div className="flex justify-end gap-2 pt-2">
    <button type="button" onClick={onCancel}
      className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
      Cancel
    </button>
    <button type="submit" disabled={saving}
      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-40">
      {saving ? 'Saving…' : submitLabel}
    </button>
  </div>
);

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({
  title, onClose, children,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export default SchoolAdminAdmissionsPage;
