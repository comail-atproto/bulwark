import type { VacationResponse } from '@/lib/jmap/types';

export function createDemoVacationResponse(): VacationResponse {
  return {
    id: 'singleton',
    isEnabled: false,
    fromDate: null,
    toDate: null,
    subject: 'Out of Office',
    textBody: 'Thank you for your email. I am currently out of the office and will return on Monday. For urgent matters, please contact support@example.com.',
    htmlBody: '<p>Thank you for your email. I am currently out of the office and will return on Monday.</p><p>For urgent matters, please contact <a href="mailto:support@example.com">support@example.com</a>.</p>',
  };
}
