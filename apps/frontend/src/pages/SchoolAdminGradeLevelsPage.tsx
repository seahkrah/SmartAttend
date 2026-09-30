/**
 * A grade school's grades, grouped by the levels it offers.
 *
 * The grades are not entered here. They follow from the levels the school
 * offers, which are set with the school's type when it is created and can be
 * extended later: a school running elementary this year that adds junior
 * high next year gets Grades 7 to 9, and nothing it already has changes.
 */
import React, { useEffect } from 'react';
import { Layers } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useSchoolStructureStore } from '../store/schoolStructureStore';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

const SchoolAdminGradeLevelsPage: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const { structure, status, forUser, load } = useSchoolStructureStore();

  // Re-read on opening: levels are changed by the platform, not on this page,
  // so what the shell loaded at sign-in may be out of date.
  useEffect(() => {
    if (userId) void load(userId, true);
  }, [userId, load]);

  const mine = forUser === userId ? structure : null;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">Grade levels</h1>
        <p className="text-sm text-secondary mt-1">
          The grades your school runs, from the levels it offers. To add or remove a level, contact
          your JJELOTECH administrator; the grades follow.
        </p>
      </header>

      {status === 'failed' ? (
        <ErrorState
          title="Grade levels could not be loaded"
          onRetry={() => userId && void load(userId, true)}
        />
      ) : !mine ? (
        <LoadingState label="Loading grade levels…" />
      ) : !mine.features.gradeLevels ? (
        <EmptyState
          icon={Layers}
          title="Your school does not use grade levels"
          description={`A ${mine.label.toLowerCase()} is organised by ${mine.labels.programmes.toLowerCase()} instead.`}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {mine.stages.map((stage) => {
            const grades = mine.gradeLevels.filter((g) => g.stage === stage.key);
            return (
              <section key={stage.key} className={`card ${stage.offered ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h2 className="font-semibold text-primary">{stage.label}</h2>
                  <span className={stage.offered ? 'badge badge-success' : 'badge'}>
                    {stage.offered ? 'Offered' : 'Not offered'}
                  </span>
                </div>
                {stage.offered ? (
                  <ul className="flex flex-wrap gap-2">
                    {grades.map((g) => (
                      <li key={g.id} className="px-3 py-1.5 rounded-lg bg-sunken text-sm text-primary">
                        {g.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Not part of your school yet.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SchoolAdminGradeLevelsPage;
