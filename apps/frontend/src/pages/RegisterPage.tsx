/**
 * "Request access": a school or employer asking to use the platform.
 *
 * This replaced a self-registration form that asked would-be students and
 * employees to choose a password and type their institution's internal ID —
 * a value nobody outside the database knows. People now get accounts from
 * their own administrator, by invitation. What this page is for is the step
 * before: an organisation leaving the details the platform needs to get back
 * to it.
 *
 * What it collects follows the usual international norms for a contact form:
 *   - only what is needed to reply (GDPR Art. 5(1)(c) data minimisation): no
 *     password, address, date of birth or identity numbers;
 *   - country as an ISO 3166-1 code, phone in E.164 international format, so
 *     a number written in Monrovia can be dialled from anywhere;
 *   - explicit, unticked consent to be contacted, with its purpose stated,
 *     recorded with the date and the wording's version;
 *   - labels on every field, required fields marked, errors announced to
 *     screen readers (WCAG 2.1 AA).
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Send } from 'lucide-react';
import { axiosClient } from '../utils/axiosClient';
import { JjeloTechLogo } from '../components/BrandLogo';

// ISO 3166-1 alpha-2. Names come from the browser (Intl.DisplayNames), so they
// are spelled correctly and follow the reader's language.
const ISO_COUNTRIES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

const SIZE_BANDS = ['1-50', '51-200', '201-1000', '1001-5000', '5000+'];

type OrgType = 'school' | 'employer' | 'both';

const EMPTY = {
  organisationName: '',
  organisationType: '' as OrgType | '',
  countryCode: '',
  sizeBand: '',
  contactName: '',
  jobTitle: '',
  email: '',
  phone: '',
  preferredContact: 'email' as 'email' | 'phone' | 'whatsapp',
  message: '',
  consent: false,
  website: '', // honeypot: hidden from people, filled by bots
};

const Field: React.FC<{ id: string; label: string; required?: boolean; hint?: string; children: React.ReactNode }> = ({
  id, label, required, hint, children,
}) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-primary">
      {label} {required ? <span className="text-accent-700 dark:text-accent-300" aria-hidden>*</span> : <span className="text-muted font-normal">(optional)</span>}
    </label>
    <div className="mt-1.5">{children}</div>
    {hint && <p id={`${id}-hint`} className="text-xs text-muted mt-1">{hint}</p>}
  </div>
);

export const RegisterPage: React.FC = () => {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string } | null>(null);

  const countries = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' }); } catch { names = null; }
    return ISO_COUNTRIES
      .map((code) => ({ code, name: names?.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const set = <K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const sizeLabel = form.organisationType === 'employer' ? 'Number of employees'
    : form.organisationType === 'both' ? 'Number of students and staff' : 'Number of students';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await axiosClient.post('/access-requests', {
        ...form,
        sizeBand: form.sizeBand || undefined,
        phone: form.phone || undefined,
        jobTitle: form.jobTitle || undefined,
        message: form.message || undefined,
      });
      setDone({ reference: data.reference ?? '' });
      window.scrollTo({ top: 0 });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Your request could not be sent. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const input = 'w-full rounded-lg border border-subtle bg-card px-3 py-2.5 text-primary placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30';

  return (
    <div className="min-h-screen bg-[#070a14] text-primary px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary">
          <ArrowLeft className="w-4 h-4" aria-hidden /> Back
        </Link>

        <div className="text-center mt-6 mb-8">
          <JjeloTechLogo size="lg" className="justify-center text-primary" />
          <h1 className="text-2xl sm:text-3xl font-bold mt-6">Request access</h1>
          <p className="text-secondary mt-2 max-w-lg mx-auto">
            Tell us about your school or organisation and how to reach you. We will get in touch to discuss
            your needs and set up your workspace.
          </p>
        </div>

        {done ? (
          <div role="status" className="rounded-2xl border border-success-500/30 bg-success-500/10 p-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-success-700 dark:text-success-400 mx-auto" aria-hidden />
            <h2 className="text-xl font-semibold mt-4">Thank you — we have your request</h2>
            <p className="text-secondary mt-2">
              We will contact you by {form.preferredContact === 'email' ? `email at ${form.email}` : `${form.preferredContact === 'whatsapp' ? 'WhatsApp' : 'phone'} on ${form.phone}`}.
            </p>
            {done.reference && <p className="text-sm text-secondary mt-3">Your reference: <span className="font-mono text-primary">{done.reference}</span></p>}
            <Link to="/" className="btn-primary inline-flex mt-6">Back to the home page</Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate={false} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-8 space-y-8" aria-describedby={error ? 'form-error' : undefined}>
            {error && (
              <p id="form-error" role="alert" className="rounded-lg border border-danger-500/40 bg-danger-500/10 px-4 py-3 text-sm text-danger-700 dark:text-danger-400">
                {error}
              </p>
            )}

            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-widest text-accent-700 dark:text-accent-300 mb-1">Your organisation</legend>
              <Field id="org" label="Organisation name" required>
                <input id="org" className={input} required maxLength={200} autoComplete="organization"
                  value={form.organisationName} onChange={(e) => set('organisationName', e.target.value)} />
              </Field>
              <div>
                <span className="block text-sm font-medium text-primary" id="type-label">
                  What do you need? <span className="text-accent-700 dark:text-accent-300" aria-hidden>*</span>
                </span>
                <div role="radiogroup" aria-labelledby="type-label" className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([['school', 'School system', 'SMS'], ['employer', 'Employee system', 'EMS'], ['both', 'Both', 'SMS + EMS']] as const).map(([v, label, sub]) => (
                    <label key={v} className={`cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${form.organisationType === v ? 'border-brand-500 bg-brand-500/10' : 'border-subtle hover:border-strong'}`}>
                      <input type="radio" name="organisationType" value={v} required className="sr-only"
                        checked={form.organisationType === v} onChange={() => set('organisationType', v)} />
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted">{sub}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field id="country" label="Country" required>
                  <select id="country" className={input} required autoComplete="country"
                    value={form.countryCode} onChange={(e) => set('countryCode', e.target.value)}>
                    <option value="">Select a country</option>
                    {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </select>
                </Field>
                <Field id="size" label={sizeLabel}>
                  <select id="size" className={input} value={form.sizeBand} onChange={(e) => set('sizeBand', e.target.value)}>
                    <option value="">Prefer not to say</option>
                    {SIZE_BANDS.map((b) => <option key={b} value={b}>{b.replace('-', '–')}</option>)}
                  </select>
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-widest text-accent-700 dark:text-accent-300 mb-1">How to reach you</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field id="name" label="Your full name" required>
                  <input id="name" className={input} required maxLength={150} autoComplete="name"
                    value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
                </Field>
                <Field id="title" label="Job title">
                  <input id="title" className={input} maxLength={150} autoComplete="organization-title"
                    placeholder="e.g. Registrar, HR Manager"
                    value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />
                </Field>
                <Field id="email" label="Work email" required>
                  <input id="email" type="email" className={input} required maxLength={255} autoComplete="email"
                    value={form.email} onChange={(e) => set('email', e.target.value)} />
                </Field>
                <Field id="phone" label="Phone" required={form.preferredContact !== 'email'}
                  hint="International format with country code, e.g. +231 77 123 4567">
                  <input id="phone" type="tel" className={input} autoComplete="tel" inputMode="tel"
                    required={form.preferredContact !== 'email'} placeholder="+"
                    aria-describedby="phone-hint"
                    value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                </Field>
              </div>
              <Field id="contact" label="Preferred way to contact you" required>
                <select id="contact" className={input} value={form.preferredContact}
                  onChange={(e) => set('preferredContact', e.target.value as typeof EMPTY.preferredContact)}>
                  <option value="email">Email</option>
                  <option value="phone">Phone call</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </Field>
              <Field id="message" label="Anything we should know">
                <textarea id="message" className={input} rows={4} maxLength={2000}
                  placeholder="What you want to manage, when you hope to start, and any questions."
                  value={form.message} onChange={(e) => set('message', e.target.value)} />
              </Field>
            </fieldset>

            {/* Honeypot: invisible to people and to assistive technology. */}
            <div aria-hidden className="absolute -left-[9999px] w-px h-px overflow-hidden">
              <label htmlFor="website">Website</label>
              <input id="website" tabIndex={-1} autoComplete="off" value={form.website}
                onChange={(e) => set('website', e.target.value)} />
            </div>

            <label className="flex items-start gap-3 text-sm text-secondary">
              <input type="checkbox" required className="mt-1 h-4 w-4 flex-shrink-0 rounded border-strong"
                checked={form.consent} onChange={(e) => set('consent', e.target.checked)} />
              <span>
                I agree that JJELOTECH SYSTEMS may use these details to contact me about this request. They are
                used for nothing else and are not shared. <span className="text-accent-700 dark:text-accent-300" aria-hidden>*</span>
              </span>
            </label>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-4">
              <p className="text-sm text-secondary">
                Already have an account? <Link to="/login" className="text-brand-700 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200">Sign in</Link>
              </p>
              <button type="submit" disabled={submitting} className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
                <Send className="w-4 h-4" aria-hidden /> {submitting ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </form>
        )}

        <p className="text-center text-xs text-muted mt-6">
          Students, staff and parents: your school or employer creates your account and sends you an invitation.
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
