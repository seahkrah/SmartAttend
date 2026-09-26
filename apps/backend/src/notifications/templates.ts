import type { Channel } from './types.js'

/**
 * The messages the platform sends when a tenant has not written its own.
 *
 * These live in code rather than as rows with a null tenant_id. A shared row
 * would be the one object in the schema that belongs to nobody, and every
 * query touching templates would need an exception to the ownership rule —
 * an exception that eventually gets copied into a query where it does not
 * belong. Defaults in code have no owner to get wrong.
 *
 * A tenant's own row for the same event and channel wins outright.
 *
 * Variables are {{ name }}. Anything a template asks for that the caller did
 * not supply is reported by the renderer rather than quietly left blank, so a
 * message that would have read "Dear ," never goes out.
 */

export interface TemplateDefinition {
  subject?: string
  body: string
  /** Variables the message is meaningless without. */
  required: string[]
  category: string
}

export type TemplateSet = Partial<Record<Channel, TemplateDefinition>>

const SIGN_OFF = '\n\n{{ tenantName }}'

export const DEFAULT_TEMPLATES: Record<string, TemplateSet> = {
  // ---------------------------------------------------------------- admissions
  'admission.submitted': {
    email: {
      subject: 'We have your application — {{ reference }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'We have received your application to {{ intakeName }}. Your reference is {{ reference }}; '
        + 'please quote it in any correspondence.\n\n'
        + 'We will write to you again when a decision has been made.' + SIGN_OFF,
      required: ['firstName', 'reference', 'intakeName', 'tenantName'],
      category: 'admissions',
    },
    sms: {
      body: '{{ tenantName }}: application {{ reference }} received. We will be in touch.',
      required: ['reference', 'tenantName'],
      category: 'admissions',
    },
  },

  'admission.offer': {
    email: {
      subject: 'An offer of a place — {{ reference }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'We are pleased to offer you a place on {{ programmeName }} for {{ intakeName }}.\n\n'
        + 'Your application reference is {{ reference }}. {{ offerDeadline }}\n\n'
        + 'Please let us know whether you wish to accept.' + SIGN_OFF,
      required: ['firstName', 'programmeName', 'intakeName', 'reference', 'tenantName'],
      category: 'admissions',
    },
    sms: {
      body: '{{ tenantName }}: you have an offer for {{ programmeName }}. Ref {{ reference }}.',
      required: ['programmeName', 'reference', 'tenantName'],
      category: 'admissions',
    },
  },

  'admission.rejected': {
    email: {
      subject: 'Your application — {{ reference }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Thank you for applying to {{ intakeName }}. After careful consideration we are not '
        + 'able to offer you a place on this occasion.\n\n'
        + 'We are grateful for the time you gave to your application, and we wish you well.'
        + SIGN_OFF,
      required: ['firstName', 'intakeName', 'tenantName'],
      category: 'admissions',
    },
  },

  'admission.waitlisted': {
    email: {
      subject: 'Your application is on our waiting list — {{ reference }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Your application to {{ intakeName }} has been placed on our waiting list. This means '
        + 'we were not able to offer you a place immediately, but we may be able to later in '
        + 'the cycle if one becomes available.\n\n'
        + 'You do not need to do anything. We will write to you either way.' + SIGN_OFF,
      required: ['firstName', 'intakeName', 'tenantName'],
      category: 'admissions',
    },
  },

  'admission.enrolled': {
    email: {
      subject: 'Welcome — your student account is ready',
      body:
        'Dear {{ firstName }},\n\n'
        + 'You are now enrolled on {{ programmeName }}. Your student number is {{ studentNumber }}.\n\n'
        + 'A separate email will invite you to choose a password for your student account.' + SIGN_OFF,
      required: ['firstName', 'programmeName', 'studentNumber', 'tenantName'],
      category: 'admissions',
    },
    in_app: {
      body: 'Welcome to {{ tenantName }}. You are enrolled on {{ programmeName }} as {{ studentNumber }}.',
      required: ['programmeName', 'studentNumber', 'tenantName'],
      category: 'admissions',
    },
  },

  // ---------------------------------------------------------------------- fees
  'fees.invoice_issued': {
    email: {
      subject: 'Invoice {{ invoiceNumber }} — {{ amount }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Invoice {{ invoiceNumber }} for {{ amount }} has been raised on your account. '
        + '{{ dueLine }}\n\n'
        + 'You can see the full breakdown and what you have paid under Fees when you sign in.'
        + SIGN_OFF,
      required: ['firstName', 'invoiceNumber', 'amount', 'tenantName'],
      category: 'fees',
    },
    in_app: {
      body: 'Invoice {{ invoiceNumber }} for {{ amount }} has been raised. {{ dueLine }}',
      required: ['invoiceNumber', 'amount'],
      category: 'fees',
    },
  },

  'fees.payment_received': {
    email: {
      subject: 'Payment received — {{ amount }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'We have received {{ amount }} against invoice {{ invoiceNumber }}. '
        + 'Your outstanding balance on that invoice is now {{ balance }}.\n\n'
        + 'Thank you.' + SIGN_OFF,
      required: ['firstName', 'amount', 'invoiceNumber', 'balance', 'tenantName'],
      category: 'fees',
    },
    in_app: {
      body: '{{ amount }} received against {{ invoiceNumber }}. Balance: {{ balance }}.',
      required: ['amount', 'invoiceNumber', 'balance'],
      category: 'fees',
    },
  },

  'fees.invoice_overdue': {
    email: {
      subject: 'Invoice {{ invoiceNumber }} is overdue',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Invoice {{ invoiceNumber }} was due on {{ dueDate }} and {{ balance }} is still '
        + 'outstanding.\n\n'
        + 'If you have already paid, or if you need to discuss the balance, please contact the '
        + 'finance office.' + SIGN_OFF,
      required: ['firstName', 'invoiceNumber', 'dueDate', 'balance', 'tenantName'],
      category: 'fees',
    },
    sms: {
      body: '{{ tenantName }}: invoice {{ invoiceNumber }} is overdue, {{ balance }} outstanding.',
      required: ['invoiceNumber', 'balance', 'tenantName'],
      category: 'fees',
    },
  },

  // --------------------------------------------------------------------- leave
  'leave.requested': {
    in_app: {
      body: '{{ employeeName }} has requested {{ leaveType }} from {{ startDate }} to {{ endDate }} ({{ days }} days).',
      required: ['employeeName', 'leaveType', 'startDate', 'endDate', 'days'],
      category: 'leave',
    },
    email: {
      subject: 'Leave request from {{ employeeName }}',
      body:
        '{{ employeeName }} has requested {{ leaveType }} from {{ startDate }} to {{ endDate }} '
        + '({{ days }} days).\n\n'
        + 'It is waiting for your decision.' + SIGN_OFF,
      required: ['employeeName', 'leaveType', 'startDate', 'endDate', 'days', 'tenantName'],
      category: 'leave',
    },
  },

  'leave.decided': {
    in_app: {
      body: 'Your {{ leaveType }} request for {{ startDate }} to {{ endDate }} was {{ decision }}.{{ noteLine }}',
      required: ['leaveType', 'startDate', 'endDate', 'decision'],
      category: 'leave',
    },
    email: {
      subject: 'Your leave request was {{ decision }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Your {{ leaveType }} request for {{ startDate }} to {{ endDate }} was {{ decision }}.'
        + '{{ noteLine }}' + SIGN_OFF,
      required: ['firstName', 'leaveType', 'startDate', 'endDate', 'decision', 'tenantName'],
      category: 'leave',
    },
  },

  // ----------------------------------------------------------------- workforce
  // The roster is published as a block, so the message names the range rather
  // than each shift. A list of twelve shifts in an email is a list nobody
  // reads; the count and the dates are enough to send somebody to look.
  'roster.published': {
    in_app: {
      body: 'Your shifts for {{ fromDate }} to {{ toDate }} are published ({{ shiftCount }} shift(s)).',
      required: ['fromDate', 'toDate', 'shiftCount'],
      category: 'roster',
    },
    email: {
      subject: 'Your shifts for {{ fromDate }} to {{ toDate }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Your rota for {{ fromDate }} to {{ toDate }} has been published: '
        + '{{ shiftCount }} shift(s), {{ totalHours }} hours.\n\n'
        + 'Sign in to see the detail.' + SIGN_OFF,
      required: ['firstName', 'fromDate', 'toDate', 'shiftCount', 'totalHours', 'tenantName'],
      category: 'roster',
    },
  },

  'timesheet.decided': {
    in_app: {
      body: 'Your timesheet for {{ fromDate }} to {{ toDate }} was {{ decision }}.{{ noteLine }}',
      required: ['fromDate', 'toDate', 'decision'],
      category: 'timesheet',
    },
    email: {
      subject: 'Your timesheet for {{ fromDate }} to {{ toDate }} was {{ decision }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Your timesheet for {{ fromDate }} to {{ toDate }} was {{ decision }}: '
        + '{{ approvedHours }} hours, of which {{ overtimeHours }} overtime.'
        + '{{ noteLine }}' + SIGN_OFF,
      required: [
        'firstName', 'fromDate', 'toDate', 'decision',
        'approvedHours', 'overtimeHours', 'tenantName',
      ],
      category: 'timesheet',
    },
  },

  // ------------------------------------------------------------------- payroll
  // Deliberately no figures in the in-app line: a payslip notification is
  // read over somebody's shoulder more often than any other message the
  // platform sends. The amount is behind the link, where the recipient chose
  // to look at it.
  'payroll.payslip_ready': {
    in_app: {
      body: 'Your payslip for {{ periodName }} is ready.',
      required: ['periodName'],
      category: 'payroll',
    },
    email: {
      subject: 'Your payslip for {{ periodName }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Your payslip for {{ periodName }} is ready, and payment is due on {{ payDate }}.\n\n'
        + 'Sign in to see the full breakdown.' + SIGN_OFF,
      required: ['firstName', 'periodName', 'payDate', 'tenantName'],
      category: 'payroll',
    },
  },

  // ------------------------------------------------------------------ academic
  'results.published': {
    in_app: {
      body: 'Your results for {{ courseName }} have been published.',
      required: ['courseName'],
      category: 'academic',
    },
    email: {
      subject: 'Your {{ courseName }} results are published',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Your results for {{ courseName }} have been published and are available when you '
        + 'sign in.' + SIGN_OFF,
      required: ['firstName', 'courseName', 'tenantName'],
      category: 'academic',
    },
  },

  // ----------------------------------------------------------------- guardians
  // Sent to a student's guardians, about the student. They are addressed by
  // the guardian's own name and always name the student, because a parent of
  // three needs to know which child a message is about before anything else.
  'guardian.absence': {
    in_app: {
      body: '{{ studentName }} was marked absent from {{ courseName }} on {{ date }}.',
      required: ['studentName', 'courseName', 'date'],
      category: 'attendance',
    },
    email: {
      subject: '{{ studentName }} was absent from {{ courseName }} on {{ date }}',
      body:
        'Dear {{ firstName }},\n\n'
        + '{{ studentName }} was marked absent from {{ courseName }} on {{ date }}.\n\n'
        + 'If you believe this is a mistake, or the absence was authorised, please contact the '
        + 'school.' + SIGN_OFF,
      required: ['firstName', 'studentName', 'courseName', 'date', 'tenantName'],
      category: 'attendance',
    },
    sms: {
      body: '{{ tenantName }}: {{ studentName }} was absent from {{ courseName }} on {{ date }}.',
      required: ['studentName', 'courseName', 'date', 'tenantName'],
      category: 'attendance',
    },
  },

  'guardian.results_published': {
    in_app: {
      body: "{{ studentName }}'s results for {{ courseName }} have been published.",
      required: ['studentName', 'courseName'],
      category: 'academic',
    },
    email: {
      subject: "{{ studentName }}'s {{ courseName }} results are published",
      body:
        'Dear {{ firstName }},\n\n'
        + "{{ studentName }}'s results for {{ courseName }} have been published. You can read "
        + 'them in the parent portal when you sign in.' + SIGN_OFF,
      required: ['firstName', 'studentName', 'courseName', 'tenantName'],
      category: 'academic',
    },
  },

  'guardian.invoice_issued': {
    in_app: {
      body: 'Invoice {{ invoiceNumber }} for {{ amount }} has been raised for {{ studentName }}. {{ dueLine }}',
      required: ['invoiceNumber', 'amount', 'studentName'],
      category: 'fees',
    },
    email: {
      subject: 'Invoice {{ invoiceNumber }} for {{ studentName }} — {{ amount }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Invoice {{ invoiceNumber }} for {{ amount }} has been raised for {{ studentName }}. '
        + '{{ dueLine }}\n\n'
        + 'The full breakdown is in the parent portal when you sign in.' + SIGN_OFF,
      required: ['firstName', 'invoiceNumber', 'amount', 'studentName', 'tenantName'],
      category: 'fees',
    },
  },

  'guardian.payment_received': {
    in_app: {
      body: '{{ amount }} received for {{ studentName }} against {{ invoiceNumber }}. Balance: {{ balance }}.',
      required: ['amount', 'studentName', 'invoiceNumber', 'balance'],
      category: 'fees',
    },
    email: {
      subject: 'Payment received for {{ studentName }} — {{ amount }}',
      body:
        'Dear {{ firstName }},\n\n'
        + 'We have received {{ amount }} for {{ studentName }} against invoice {{ invoiceNumber }}. '
        + 'The outstanding balance on that invoice is now {{ balance }}.\n\n'
        + 'Thank you.' + SIGN_OFF,
      required: ['firstName', 'amount', 'studentName', 'invoiceNumber', 'balance', 'tenantName'],
      category: 'fees',
    },
  },

  // ------------------------------------------------------------------- account
  // These carry a single-use link that sets the account's password. Their
  // wording is fixed in code (tenants cannot override it) and their bodies
  // are withheld from the outbox views (SENSITIVE_EVENTS below).
  'account.invitation': {
    email: {
      subject: 'Set up your {{ tenantName }} account',
      body:
        'Dear {{ firstName }},\n\n'
        + 'An account has been created for you at {{ tenantName }}. To start using it, choose a '
        + 'password here:\n\n{{ link }}\n\n'
        + 'The link works once and expires in {{ validFor }}. If it has expired, ask your '
        + 'administrator to send a new invitation.\n\n'
        + 'If you were not expecting this, you can ignore it; nothing happens until the link is used.'
        + SIGN_OFF,
      required: ['firstName', 'tenantName', 'link', 'validFor'],
      category: 'account',
    },
  },
  'account.password_reset': {
    email: {
      subject: 'Reset your {{ tenantName }} password',
      body:
        'Dear {{ firstName }},\n\n'
        + 'Someone asked to reset the password for your {{ tenantName }} account. If it was you, '
        + 'choose a new password here:\n\n{{ link }}\n\n'
        + 'The link works once and expires in {{ validFor }}. Using it signs you out everywhere.\n\n'
        + 'If it was not you, ignore this email; your password has not changed.'
        + SIGN_OFF,
      required: ['firstName', 'tenantName', 'link', 'validFor'],
      category: 'account',
    },
  },

  // An administrator reset this person's access: unlike a self-service
  // reset, the old password has already stopped working.
  'account.access_reset': {
    email: {
      subject: 'Your {{ tenantName }} access has been reset',
      body:
        'Dear {{ firstName }},\n\n'
        + 'An administrator at {{ tenantName }} has reset your access. Your old password no longer works '
        + 'and you have been signed out everywhere. Choose a new password here:\n\n{{ link }}\n\n'
        + 'The link works once and expires in {{ validFor }}. If you did not expect this, contact your '
        + 'administrator.'
        + SIGN_OFF,
      required: ['firstName', 'tenantName', 'link', 'validFor'],
      category: 'account',
    },
  },

  // A tenant administrator checking that a channel works. Deliberately blunt
  // about what it is, so nobody mistakes it for a real notice.
  'system.test': {
    email: {
      subject: 'Test message from {{ tenantName }}',
      body:
        'This is a test of the {{ channelName }} channel, sent by {{ actorName }} at '
        + '{{ sentAt }}.\n\nIf you received it, the channel is working.',
      required: ['tenantName', 'channelName', 'actorName', 'sentAt'],
      category: 'system',
    },
    sms: {
      body: '{{ tenantName }}: test of the {{ channelName }} channel. If you got this, it works.',
      required: ['tenantName', 'channelName'],
      category: 'system',
    },
    push: {
      body: '{{ tenantName }}: test of the {{ channelName }} channel.',
      required: ['tenantName', 'channelName'],
      category: 'system',
    },
    in_app: {
      body: 'Test of the {{ channelName }} channel, sent by {{ actorName }}.',
      required: ['channelName', 'actorName'],
      category: 'system',
    },
  },
}

/**
 * Events whose messages carry a credential (a link that sets a password).
 * Tenants cannot override their templates, and nobody can read their bodies
 * back out of the outbox.
 */
export const SENSITIVE_EVENTS: ReadonlySet<string> = new Set(['account.invitation', 'account.password_reset', 'account.access_reset'])

export function defaultTemplate(eventKey: string, channel: Channel): TemplateDefinition | null {
  return DEFAULT_TEMPLATES[eventKey]?.[channel] ?? null
}

export function knownEventKeys(): string[] {
  return Object.keys(DEFAULT_TEMPLATES).sort()
}

/** Which channels an event has a default for, in preference order. */
export function defaultChannelsFor(eventKey: string): Channel[] {
  const set = DEFAULT_TEMPLATES[eventKey]
  if (!set) return []
  return (['in_app', 'email', 'sms', 'push'] as Channel[]).filter((c) => set[c])
}

export function categoryFor(eventKey: string): string {
  const set = DEFAULT_TEMPLATES[eventKey]
  if (!set) return 'general'
  for (const channel of ['email', 'in_app', 'sms', 'push'] as Channel[]) {
    if (set[channel]) return set[channel]!.category
  }
  return 'general'
}
