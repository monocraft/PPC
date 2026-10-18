const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const NOTICE = /^ASCM Report Accessories HyperX Release Notification ([A-Za-z]+) (\d{4})$/i;
const WORKBOOK = /^ASCM Report_HyperX_(\d{4}-\d{2}-\d{2})\.xlsx$/;

export class AscmMailPolicyError extends Error {
  constructor() {
    super('The ASCM source requires review.');
    this.code = 'ASCM_SOURCE_REVIEW';
  }
}
const reject = () => { throw new AscmMailPolicyError(); };
const text = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit;
const calendarDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

// Graph supplies UTC timestamps; explicit ISO offsets are accepted without permitting date normalization.
export function parseAscmInstant(value) {
  if (!text(value, 40)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !calendarDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59
    || Number(match[4]) > 59 || Number(match[6] || 0) > 14 || Number(match[7] || 0) > 59
    || (Number(match[6]) === 14 && Number(match[7]) !== 0)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function publicationIdentity(sender, subject) {
  if (!text(sender, 254) || sender.trim().toLowerCase() !== 'linny.chen@hp.com'
    || !text(subject, 256)) return null;
  const match = NOTICE.exec(subject.trim());
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  if (month < 0 || Number(match[2]) < 1000) return null;
  return { year: Number(match[2]), month: month + 1 };
}

export function isAscmMonthlyNotice({ sender, subject } = {}) {
  return publicationIdentity(sender, subject) !== null;
}

export function validateAscmEnvelope({ sender, subject, receivedAt, messageId, fileName } = {}) {
  const publication = publicationIdentity(sender, subject);
  const received = parseAscmInstant(receivedAt);
  const match = text(fileName, 128) ? WORKBOOK.exec(fileName) : null;
  if (!publication || received === null || !text(messageId, 2048) || /[\r\n\0]/.test(messageId)
    || !match || !calendarDay(match[1])) reject();
  const reportDate = match[1];
  if (reportDate > new Date(received).toISOString().slice(0, 10)) reject();
  const reportMonth = Number(reportDate.slice(0, 4)) * 12 + Number(reportDate.slice(5, 7));
  const publicationIndex = publication.year * 12 + publication.month;
  if (reportMonth !== publicationIndex && reportMonth !== publicationIndex - 1) reject();
  return { reportDate, publicationMonth: `${publication.year}-${String(publication.month).padStart(2, '0')}` };
}
