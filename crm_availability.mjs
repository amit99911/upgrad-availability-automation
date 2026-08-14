import { chromium } from 'playwright';

const CRM_URL = 'https://crm.upgrad.com';
const EMAIL = process.env.CRM_EMAIL;
const PASSWORD = process.env.CRM_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('CRM_EMAIL and CRM_PASSWORD secrets are required');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ timezoneId: 'Asia/Calcutta' });
const page = await context.newPage();
page.setDefaultTimeout(20000);

async function login() {
  await page.goto(`${CRM_URL}/login`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/login')) {
    await page.getByPlaceholder('name@email.com').fill(EMAIL);
    await page.getByPlaceholder('Enter Your Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'LOGIN' }).click();
    await page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 30000 });
  }
}

async function calendarCells() {
  return page.locator('.tui-full-calendar-weekday-grid-line');
}

async function findDateCell(date) {
  const cells = await calendarCells();
  const count = await cells.count();
  const targetDay = String(date.getDate());
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Calcutta' }));
  const sameMonth = date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  let lastCurrentIndex = -1;
  const matches = [];
  for (let i = 0; i < count; i++) {
    const cell = cells.nth(i);
    const span = cell.locator('.tui-full-calendar-weekday-grid-date');
    if (!(await span.count())) continue;
    const text = (await span.first().innerText()).trim();
    const cls = (await cell.getAttribute('class')) || '';
    if (!cls.includes('extra-date')) lastCurrentIndex = i;
    if (text === targetDay) matches.push({ i, extra: cls.includes('extra-date') });
  }
  const candidate = sameMonth ? matches.find(m => !m.extra) : matches.find(m => m.extra && m.i > lastCurrentIndex);
  return candidate ? cells.nth(candidate.i) : null;
}

async function setTime(input, value) {
  await input.click();
  await input.fill(value);
  await input.press('Enter');
  await page.waitForTimeout(150);
}

async function updateOpenDates() {
  await page.goto(`${CRM_URL}/crm/availability/list`, { waitUntil: 'networkidle' });
  const slot45 = page.getByText('45 min', { exact: true });
  if (await slot45.count()) await slot45.click();

  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Calcutta' }));
  const dates = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
  let changed = 0;
  let skipped = 0;
  for (const date of dates) {
    const cell = await findDateCell(date);
    if (!cell) { skipped++; continue; }
    const text = await cell.innerText();
    if (text.includes('07:00 - 23:00')) { skipped++; continue; }
    try {
      await cell.click();
      await page.waitForTimeout(300);
      const start = page.locator('#addAvailabilityForm_dateAvailability');
      const end = page.locator('input[placeholder="End time"]');
      if (!(await start.count()) || !(await end.count())) { skipped++; continue; }
      await setTime(start, '07:00');
      await setTime(end, '23:00');
      await page.getByRole('button', { name: 'Confirm', exact: true }).click();
      changed++;
      await page.waitForTimeout(250);
    } catch (error) {
      console.log(`Skipped ${date.toISOString().slice(0, 10)}: ${error.message}`);
      skipped++;
    }
  }
  if (changed > 0) {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/Availability updated/i).waitFor({ state: 'visible', timeout: 30000 });
  }
  console.log(JSON.stringify({ changed, skipped, checked: dates.length, timezone: 'Asia/Kolkata', slotDuration: '45 min' }));
}

try {
  await login();
  await updateOpenDates();
} finally {
  await browser.close();
}
