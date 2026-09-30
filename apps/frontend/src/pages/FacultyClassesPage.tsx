/**
 * A grade-school teacher's classes this year, and who is in each.
 *
 * Lists the classes the teacher is class teacher of. The register and report
 * cards will be reached from here.
 */
import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { gradeSchoolService, studentName, type ClassStudent, type SchoolClass } from '../services/gradeSchoolService';
import { EmptyState, ErrorState, LoadingState } from '../components/states/PageStates';

const errorOf = (e: any, fallback: string): string => e?.response?.data?.error ?? fallback;

const ClassCard: React.FC<{ cls: SchoolClass }> = ({ cls }) => {
  const [students, setStudents] = useState<ClassStudent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gradeSchoolService.classStudents(cls.id)
      .then(setStudents)
      .catch((e) => setError(errorOf(e, 'The class list could not be loaded')));
  }, [cls.id]);

  return (
    <section className="card space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-primary">{cls.display_name}</h2>
        <span className="text-sm text-muted">{cls.student_count}{cls.capacity ? ` of ${cls.capacity}` : ''} students</span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-600">{error}</p>
      ) : students === null ? (
        <LoadingState label="Loading…" rows={2} />
      ) : students.length === 0 ? (
        <p className="text-sm text-muted">No students placed in this class yet.</p>
      ) : (
        <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm list-decimal list-inside">
          {students.map((s) => (
            <li key={s.id} className="text-primary">
              {studentName(s)} <span className="text-muted font-mono text-xs">{s.student_id}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

const FacultyClassesPage: React.FC = () => {
  const [data, setData] = useState<{ year: { name: string } | null; classes: SchoolClass[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    gradeSchoolService.listClasses({ mine: true })
      .then(setData)
      .catch((e) => setError(errorOf(e, 'Your classes could not be loaded')));
  };
  useEffect(load, []);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold text-primary">My classes</h1>
        <p className="text-sm text-secondary mt-1">
          The classes you are class teacher of{data?.year ? ` in ${data.year.name}` : ''}.
        </p>
      </header>
      {error ? (
        <ErrorState title="Your classes could not be loaded" description={error} onRetry={load} />
      ) : data === null ? (
        <LoadingState label="Loading your classes…" />
      ) : data.classes.length === 0 ? (
        <EmptyState icon={Users} title="You are not class teacher of a class this year"
          description="Your school's administrator assigns class teachers on the Classes page." />
      ) : (
        data.classes.map((c) => <ClassCard key={c.id} cls={c} />)
      )}
    </div>
  );
};

export default FacultyClassesPage;
