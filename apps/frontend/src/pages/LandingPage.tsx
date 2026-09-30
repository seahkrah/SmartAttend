import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, GraduationCap, Briefcase, ShieldCheck, Bell, ScrollText, ScanFace, Check,
} from 'lucide-react';
import { FadeIn } from '../components/Animations';
import { JjeloTechLogo, BRAND_NAME, BRAND_TAGLINE } from '../components/BrandLogo';

/**
 * The public front page.
 *
 * Says what the product is — a school management system and an employee
 * management system on one platform — and lists only what is built. It used
 * to sell an attendance app, quote developer statistics ("31+ API endpoints",
 * "24 database tables"), claim "thousands of organizations", and link six
 * footer items and a "View Demo" button to nothing. Those are gone rather
 * than reworded: a front page that overstates is the first thing a buyer
 * checks.
 */

const SMS = [
  'Students, lecturers, departments, programmes and courses',
  'Timetables, class registers and attendance',
  'Gradebook, published results and transcripts with CGPA',
  'Admissions: intakes, applications, decisions, enrolment',
  'Fees: invoices, payments, statements and clearance',
  'Guardians and a parent portal, with absence and fee alerts',
];

const EMS = [
  'Employees, departments and contracts',
  'Self-service check-in and check-out',
  'Shift patterns, rosters and timesheets',
  'Leave types, balances, requests and approvals',
  'Payroll: components, tax bands, runs and payslips',
  'HR dashboards for today\'s attendance and trends',
];

const FOUNDATIONS = [
  {
    icon: ShieldCheck,
    title: 'Each organisation kept apart',
    body: 'Every school and company is its own tenant, enforced in the API and again in the database.',
  },
  {
    icon: ScrollText,
    title: 'An audit trail that cannot be edited',
    body: 'Who changed what, and when, recorded immutably and checksummed.',
  },
  {
    icon: Bell,
    title: 'Notifications that are really sent',
    body: 'Email, SMS and in-app messages through a real outbox, with a delivery log.',
  },
  {
    icon: ScanFace,
    title: 'Optional face check-in, with consent',
    body: 'Server-side face matching with a liveness check; templates encrypted at rest.',
  },
];

const ProductCard: React.FC<{
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  items: string[];
  tone: 'brand' | 'accent';
}> = ({ icon: Icon, eyebrow, title, items, tone }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8 h-full">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${tone === 'brand' ? 'bg-brand-500/20 text-brand-700 dark:text-brand-300' : 'bg-accent-500/20 text-accent-700 dark:text-accent-300'}`}>
      <Icon className="w-6 h-6" aria-hidden />
    </div>
    <p className={`text-xs font-semibold uppercase tracking-widest ${tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-accent-700 dark:text-accent-300'}`}>{eyebrow}</p>
    <h3 className="text-2xl font-bold mt-1 mb-5">{title}</h3>
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-secondary">
          <Check className={`w-5 h-5 flex-shrink-0 mt-0.5 ${tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-accent-700 dark:text-accent-300'}`} aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

export const LandingPage: React.FC = () => (
  <div className="min-h-screen bg-[#070a14] text-primary">
    {/* A soft dawn behind the hero, taken from the mark's own colours. */}
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] overflow-hidden">
      <div className="absolute left-1/2 top-[-12rem] -translate-x-1/2 w-[56rem] h-[36rem] rounded-full bg-accent-500/15 blur-3xl" />
      <div className="absolute left-1/2 top-[6rem] -translate-x-1/2 w-[44rem] h-[20rem] rounded-full bg-brand-600/20 blur-3xl" />
    </div>

    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070a14]/80 backdrop-blur-xl">
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4" aria-label="Site">
        <Link to="/" aria-label={`${BRAND_NAME} home`}>
          <JjeloTechLogo size="sm" className="text-primary" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <a href="#platforms" className="hidden sm:inline text-sm text-secondary hover:text-primary">Platforms</a>
          <Link to="/login" className="whitespace-nowrap text-sm text-secondary hover:text-primary px-2 py-1">Sign in</Link>
          <Link to="/register" className="hidden sm:inline-flex whitespace-nowrap btn-primary text-sm !py-2 !px-4">Request access</Link>
        </div>
      </nav>
    </header>

    <main className="relative">
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 text-center">
        <FadeIn>
          <img
            src="/logos/jjelotech-logo-wordmark.svg"
            alt=""
            className="mx-auto w-44 sm:w-56 h-auto mb-8 drop-shadow-[0_0_40px_rgba(254,148,1,0.25)]"
          />
          <p className="text-xs sm:text-sm font-semibold uppercase tracking-[0.3em] text-accent-700 dark:text-accent-300">{BRAND_TAGLINE}</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mt-4 max-w-4xl mx-auto">
            Run your school or your workforce on one platform
          </h1>
          <p className="text-lg sm:text-xl text-secondary mt-6 max-w-2xl mx-auto leading-relaxed">
            A school management system and an employee management system, sharing one secure foundation:
            accounts, notifications, documents, audit and face check-in.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/login" className="btn-primary inline-flex items-center justify-center gap-2">
              Sign in <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
            <a href="#platforms" className="btn-outline inline-flex items-center justify-center">
              See what is included
            </a>
          </div>
          <p className="mt-6 text-sm text-secondary">
            Setting up a new school or organisation?{' '}
            <Link to="/register" className="text-accent-700 dark:text-accent-300 hover:text-accent-700 dark:hover:text-accent-200 underline-offset-4 hover:underline">Request access</Link>
          </p>
        </FadeIn>
      </section>

      {/* The two products */}
      <section id="platforms" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 scroll-mt-20">
        <FadeIn>
          <h2 className="text-3xl sm:text-4xl font-bold text-center">Two platforms, one system</h2>
          <p className="text-secondary text-center mt-3 max-w-2xl mx-auto">
            Each school or company signs in to its own workspace. Access to one never implies access to the other.
          </p>
        </FadeIn>
        <div className="grid md:grid-cols-2 gap-6 mt-10">
          <FadeIn delay={0.1}>
            <ProductCard icon={GraduationCap} eyebrow="SMS" title="School Management System" items={SMS} tone="brand" />
          </FadeIn>
          <FadeIn delay={0.2}>
            <ProductCard icon={Briefcase} eyebrow="EMS" title="Employee Management System" items={EMS} tone="accent" />
          </FadeIn>
        </div>
      </section>

      {/* Foundations */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <FadeIn>
          <h2 className="text-3xl sm:text-4xl font-bold text-center">Built on a foundation you can trust</h2>
        </FadeIn>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
          {FOUNDATIONS.map(({ icon: Icon, title, body }, i) => (
            <FadeIn key={title} delay={0.05 * i}>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 h-full">
                <Icon className="w-6 h-6 text-accent-700 dark:text-accent-300 mb-3" aria-hidden />
                <h3 className="font-semibold">{title}</h3>
                <p className="text-sm text-secondary mt-2 leading-relaxed">{body}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* Call to action */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-brand-600/20 to-accent-500/10 p-8 sm:p-10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold">Already set up by your school or employer?</h2>
          <p className="text-secondary mt-3">
            Sign in with the account your administrator created for you, or use the link in your invitation email.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/login" className="btn-primary inline-flex items-center justify-center gap-2">
              Sign in <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
            <Link to="/forgot-password" className="btn-outline inline-flex items-center justify-center">
              Forgot your password?
            </Link>
          </div>
        </div>
      </section>
    </main>

    <footer className="border-t border-white/10 py-8 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-secondary">
        <JjeloTechLogo size="sm" className="text-primary" />
        <p>© {new Date().getFullYear()} {BRAND_NAME}. All rights reserved. Powered by JjeloTech.</p>
      </div>
    </footer>
  </div>
);

export default LandingPage;
