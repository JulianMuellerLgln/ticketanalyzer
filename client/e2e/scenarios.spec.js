import { test, expect } from '@playwright/test';
import { setupMocks } from './helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 1: App lädt – alle Services offline
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 1: App lädt – Services offline', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort());

  await page.goto('/');
  await page.waitForTimeout(600);

  // StatusBar soll "LLM offline" und "Jira offline" zeigen
  await expect(page.getByText('LLM offline')).toBeVisible();
  await expect(page.getByText('Jira offline')).toBeVisible();

  // Select-Dropdown soll vorhanden und leer sein
  await expect(page.locator('.toolbar select.input')).toBeVisible();
  await expect(page.locator('.toolbar select.input')).toHaveValue('');

  await page.screenshot({ path: 'e2e/screenshots/01_app_offline.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 2: Jira online – Projekt auswählen, Tickets laden & filtern
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 2: Projekt auswählen und Tickets laden', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');

  // Warte auf Jira-Status
  await expect(page.getByText('Jira connected')).toBeVisible();
  await expect(page.getByText('LLM online')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/02a_app_online.png', fullPage: true });

  // Projekt auswählen
  await page.locator('.toolbar select.input').selectOption('AXON');
  await page.waitForTimeout(400);

  // Alle 4 Tickets sollen sichtbar sein
  await expect(page.getByText('Implement login flow')).toBeVisible();
  await expect(page.getByText('Fix dashboard crash on mobile')).toBeVisible();
  await expect(page.getByText('Add dark mode toggle')).toBeVisible();
  await expect(page.getByText('Improve search performance')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/02b_tickets_loaded.png', fullPage: true });

  // Suche nach "crash"
  const searchInput = page.locator('.tl-search .input');
  await searchInput.fill('crash');
  await page.waitForTimeout(300);

  await expect(page.getByText('Fix dashboard crash on mobile')).toBeVisible();
  await expect(page.getByText('Implement login flow')).not.toBeVisible();

  // Treffer-Zähler soll "1" zeigen
  await expect(page.locator('.tl-search .muted')).toHaveText('1');

  await page.screenshot({ path: 'e2e/screenshots/02c_ticket_search.png', fullPage: true });

  // Filter leeren
  await searchInput.fill('');
  await page.waitForTimeout(200);
  await expect(page.locator('.tl-search .muted')).toHaveText('4');
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 3: LLM Insights – Analyse starten
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 3: LLM-Analyse starten', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await page.locator('.toolbar select.input').selectOption('AXON');
  await page.waitForTimeout(400);

  // Analyse-Button klicken
  const runBtn = page.getByRole('button', { name: 'Run Analysis' });
  await expect(runBtn).toBeEnabled();
  await runBtn.click();
  await page.waitForTimeout(600);

  // Summary soll angezeigt werden
  await expect(page.getByText(/The backlog has 4 tickets/)).toBeVisible();

  // Suggestions-Sektion soll aufgeklappt sein
  await expect(page.getByText('Suggestions')).toBeVisible();
  await expect(page.getByText('Mobile crash is critical')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/03a_llm_analysis.png', fullPage: true });

  // Gaps-Sektion aufklappen
  await page.getByText('Gaps').click();
  await page.waitForTimeout(250);
  await expect(page.getByText('No ticket for automated testing coverage.')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/03b_gaps_section.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 4: Idea Evaluator – Idee bewerten
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 4: Idee bewerten', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await page.waitForTimeout(500);

  const textarea = page.locator('.idea-textarea');
  await textarea.fill('Build an AI-powered ticket triage system that auto-assigns priorities');

  await page.screenshot({ path: 'e2e/screenshots/04a_idea_typed.png', fullPage: true });

  const evalBtn = page.getByRole('button', { name: 'Evaluate' });
  await expect(evalBtn).toBeEnabled();
  await evalBtn.click();
  await page.waitForTimeout(600);

  // Ergebnis-Meter sollen erscheinen
  await expect(page.getByText('Feasibility')).toBeVisible();
  await expect(page.locator('.meter-label', { hasText: 'Effort' })).toBeVisible();
  await expect(page.locator('.meter-label', { hasText: 'Value' })).toBeVisible();

  // Verdict
  await expect(page.getByText('Strong idea with clear user value.')).toBeVisible();

  // Risks & Next Steps
  await expect(page.getByText('Risks')).toBeVisible();
  await expect(page.getByText('Next steps')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/04b_idea_result.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 5: Roadmap – Meilenstein hinzufügen & entfernen
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 5: Roadmap Meilenstein hinzufügen', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await page.waitForTimeout(500);

  // Standard-Meilensteine sollen schon da sein
  await expect(page.getByText('MVP')).toBeVisible();
  await expect(page.getByText('Beta Release')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/05a_roadmap_initial.png', fullPage: true });

  // Neuen Meilenstein hinzufügen
  const titleInput = page.locator('.roadmap-form .input').first();
  await titleInput.fill('GA Release');

  const dateInput = page.locator('.roadmap-form .input').nth(1);
  await dateInput.fill('2025-Q4');

  const statusSelect = page.locator('.roadmap-form select');
  await statusSelect.selectOption('in progress');

  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(300);

  await expect(page.getByText('GA Release')).toBeVisible();
  await expect(page.getByText('2025-Q4')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/05b_milestone_added.png', fullPage: true });

  // MVP entfernen: ersten Trash-Button in der Roadmap-Timeline klicken
  const trashButtons = page.locator('.roadmap-timeline .icon-btn');
  await trashButtons.first().click();
  await page.waitForTimeout(300);

  await expect(page.getByText('MVP')).not.toBeVisible();
  await expect(page.getByText('Beta Release')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/05c_milestone_removed.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 6: JiraSync – Tickets eingeben und Sync starten
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 6: JiraSync – Ticket synchronisieren', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');

  // Projekt auswählen (Sync-Button braucht ein Projekt)
  await page.locator('.toolbar select.input').selectOption('AXON');
  await page.waitForTimeout(300);

  // Ersten Ticket-Summary füllen
  const summaryInput = page.locator('.js-summary').first();
  await summaryInput.fill('Add OAuth2 login support');

  // Typ auf "Story" setzen
  await page.locator('.js-type').first().selectOption('Story');

  // Zweiten Ticket per "+ Add" hinzufügen
  await page.getByRole('button', { name: /\+ Add/ }).click();
  await page.waitForTimeout(200);

  const summaryInputs = page.locator('.js-summary');
  await summaryInputs.nth(1).fill('Fix rate limiting bug');

  await page.screenshot({ path: 'e2e/screenshots/06a_jirasync_filled.png', fullPage: true });

  // Sync starten
  await page.getByRole('button', { name: 'Sync to Jira' }).click();
  await page.waitForTimeout(800);

  // Tickets sollen "done" (grünes Häkchen) bekommen
  // Prüfe, dass Jira-Keys erscheinen (AXON-100, AXON-101)
  await expect(page.getByText('AXON-100')).toBeVisible();
  await expect(page.getByText('AXON-101')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/06b_jirasync_done.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 7: Sprache umschalten EN → DE
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 7: Sprache umschalten (EN → DE)', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await page.waitForTimeout(400);

  // Englische Texte sollen sichtbar sein
  await expect(page.getByText('Technical Backlog Intelligence')).toBeVisible();
  // "Select project…" ist ein <option> inside der select – prüfe den select-Value
  await expect(page.locator('.toolbar select.input')).toHaveValue('');

  await page.screenshot({ path: 'e2e/screenshots/07a_lang_en.png', fullPage: true });

  // Sprache wechseln
  await page.getByRole('button', { name: /DE/ }).click();
  await page.waitForTimeout(300);

  // Deutsche Texte sollen erscheinen
  await expect(page.getByText('Technische Backlog-Intelligenz')).toBeVisible();
  await expect(page.locator('.toolbar select.input')).toHaveValue('');
  await expect(page.getByText('KI-Analyse')).toBeVisible();
  await expect(page.getByText('Ideen-Bewertung')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/07b_lang_de.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 8: Widget maximieren & minimieren
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 8: Widget maximieren und minimieren', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await page.waitForTimeout(400);

  // Tickets-Widget maximieren: den ⊞ Button im ersten Widget klicken
  const maximizeBtn = page.locator('.widget').first().locator('button.icon-btn');
  await expect(maximizeBtn).toBeVisible();
  await maximizeBtn.click();
  await page.waitForTimeout(300);

  // Widget soll expanded-Klasse haben
  await expect(page.locator('.widget--expanded')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/08a_widget_expanded.png', fullPage: true });

  // Wieder minimieren
  await maximizeBtn.click();
  await page.waitForTimeout(300);
  await expect(page.locator('.widget--expanded')).not.toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/08b_widget_minimized.png', fullPage: true });
});
