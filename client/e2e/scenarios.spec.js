import { test, expect } from '@playwright/test';
import { setupMocks } from './helpers.js';

function projectSelect(page) {
  return page.locator('.toolbar select.input').first();
}

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
  await expect(projectSelect(page)).toBeVisible();
  await expect(projectSelect(page)).toHaveValue('');

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
  await expect(page.locator('.toolbar-right select.input')).toHaveValue('qwen3:14b');
  await expect(page.getByText('· qwen3:14b')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/02a_app_online.png', fullPage: true });

  // Projekt auswählen
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  await expect(page.locator('.sprint-section-title', { hasText: 'Sprint backlog' }).first()).toBeVisible();
  await expect(page.locator('.sprint-section-title').filter({ hasText: /^Backlog$/ })).toBeVisible();
  await expect(page.locator('.sprint-section-title', { hasText: 'Sprint 25' })).toBeVisible();
  await expect(page.locator('.sprint-section-title').filter({ hasText: /^Archive$/ })).toBeVisible();

  // Alle 4 Tickets sollen sichtbar sein
  await expect(page.locator('.ticket-table-row', { hasText: 'Implement login flow' })).toBeVisible();
  await expect(page.locator('.ticket-table-row', { hasText: 'Fix dashboard crash on mobile' })).toBeVisible();
  await expect(page.locator('.ticket-table-row', { hasText: 'Add dark mode toggle' })).toBeVisible();
  await expect(page.locator('.ticket-table-row', { hasText: 'Improve search performance' })).toBeVisible();
  await expect(page.locator('.ticket-table-row', { hasText: 'MOD-1' })).toBeVisible();
  await expect(page.getByText('5 · well defined')).toBeVisible();
  await expect(page.getByText('1 · ok')).toBeVisible();
  await expect(page.locator('.ticket-table-acceptance', { hasText: '0 · missing' })).toHaveCount(2);

  await page.screenshot({ path: 'e2e/screenshots/02b_tickets_loaded.png', fullPage: true });

  // Suche nach "crash"
  const searchInput = page.locator('.tl-search .input');
  await searchInput.fill('crash');
  await page.waitForTimeout(300);

  await expect(page.locator('.ticket-table-row', { hasText: 'Fix dashboard crash on mobile' })).toBeVisible();
  await expect(page.locator('.ticket-table-row', { hasText: 'Implement login flow' })).toHaveCount(0);

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
  const captures = {};
  await setupMocks(page, { captures });
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  // Analyse-Button klicken
  const runBtn = page.getByRole('button', { name: 'Run Analysis' });
  await expect(runBtn).toBeEnabled();
  await runBtn.click();
  await page.waitForTimeout(600);

  // Summary soll angezeigt werden
  await expect(page.getByText(/The backlog has 4 tickets/)).toBeVisible();
  await expect(page.getByText('Confidence')).not.toBeVisible();

  // Suggestions-Sektion soll aufgeklappt sein
  await expect(page.getByRole('button', { name: 'Suggestions' })).toBeVisible();
  await expect(page.getByText('Mobile crash is critical')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/03a_llm_analysis.png', fullPage: true });

  // Gaps-Sektion aufklappen
  await page.getByText('Gaps').click();
  await page.waitForTimeout(250);
  await expect(page.getByText('No ticket for automated testing coverage.')).toBeVisible();
  expect(captures.analyze.model).toBe('qwen3:14b');

  await page.screenshot({ path: 'e2e/screenshots/03b_gaps_section.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 4: Idea Evaluator – Idee bewerten
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 4: Idee bewerten', async ({ page }) => {
  const captures = {};
  await setupMocks(page, { captures });
  await page.goto('/');
  await page.waitForTimeout(500);

  await page.locator('.toolbar-right select.input').selectOption('qwen3:4b');

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
  expect(captures.evaluateIdea.model).toBe('qwen3:4b');

  await page.screenshot({ path: 'e2e/screenshots/04b_idea_result.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 5: Roadmap – Tickets als Timeline anzeigen
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 5: Roadmap Timeline anzeigen', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(500);

  const roadmap = page.locator('.roadmap-timeline');
  await expect(roadmap).toBeVisible();
  await expect(page.getByText('Delivered outcomes and shipped items instead of open backlog work.')).toBeVisible();
  await expect(roadmap.getByText('AXON-4 - Improve search performance')).toBeVisible();
  await expect(roadmap.getByText('Delivered')).toBeVisible();
  await expect(roadmap.getByText('2 Points')).toBeVisible();
  await expect(roadmap.locator('.milestone-date').first()).toBeVisible();
  await expect(roadmap.getByText('done')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/05a_roadmap_initial.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 6: JiraSync – Tickets eingeben und Sync starten
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 6: JiraSync – Ticket synchronisieren', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');

  // Projekt auswählen (Sync-Button braucht ein Projekt)
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(300);

  await expect(page.locator('.js-form-grid')).toBeVisible();

  const summaryInput = page.locator('.js-field', { hasText: 'Summary *' }).locator('input');
  await summaryInput.fill('Add OAuth2 login support');

  const descriptionInput = page.locator('.js-field', { hasText: 'Description' }).locator('textarea');
  await descriptionInput.fill('Acceptance Criteria\n- OAuth2 login succeeds\n- Existing auth flow stays stable');

  const labelsInput = page.locator('.js-field', { hasText: 'Labels' }).locator('input');
  await labelsInput.fill('auth,security');

  await page.screenshot({ path: 'e2e/screenshots/06a_jirasync_filled.png', fullPage: true });

  // Sync starten
  await page.getByRole('button', { name: 'Sync to Jira' }).click();
  await page.waitForTimeout(800);

  // Ticket soll "done" (grünes Häkchen) bekommen
  await expect(page.getByText('AXON-100')).toBeVisible();

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
  await expect(page.getByText('Geo IT delivery cockpit for agile Jira teams')).toBeVisible();
  // "Select project…" ist ein <option> inside der select – prüfe den select-Value
  await expect(projectSelect(page)).toHaveValue('');

  await page.screenshot({ path: 'e2e/screenshots/07a_lang_en.png', fullPage: true });

  // Sprache wechseln
  await page.getByRole('button', { name: /DE/ }).click();
  await page.waitForTimeout(300);

  // Deutsche Texte sollen erscheinen
  await expect(page.getByText('Geo-IT-Liefercockpit fuer agile Jira-Teams')).toBeVisible();
  await expect(projectSelect(page)).toHaveValue('');
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

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 9: Ticketdetails im Modal anzeigen
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 9: Ticketdetails anzeigen', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  await page.locator('.ticket-table-row', { hasText: 'Implement login flow' }).click();

  const modal = page.locator('.ticket-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByText('Grace Hopper')).toBeVisible();
  await expect(modal.getByText('Ada Lovelace')).toBeVisible();
  await expect(modal.getByText('Portal UI')).toBeVisible();
  await expect(modal.getByText('2026.09')).toBeVisible();
  await expect(modal.getByText('Alan Turing')).toBeVisible();
  await expect(modal.getByText('Please keep the validation errors inline')).toBeVisible();
  await expect(modal.getByText('MOD-1 · Modernize login and onboarding flow')).toBeVisible();
  await expect(modal.locator('.ticket-detail-field', { hasText: 'Points' }).getByText('5')).toBeVisible();
  await expect(modal.getByText('Ticket check tool')).toBeVisible();
  await expect(modal.getByText('Ready progress: 5/6')).toBeVisible();
  await expect(modal.getByRole('link', { name: 'Runbook' })).toHaveAttribute('href', 'https://example.com/runbook');

  await modal.getByLabel('Open dependencies or questions are transparent.').check();
  await expect(modal.getByText('Ready progress: 6/6')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/09a_ticket_modal.png', fullPage: true });

  await page.locator('.ticket-modal .icon-btn').click();
  await expect(page.locator('.ticket-modal')).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 12: Modus wechseln und Scrum Guide anzeigen
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 12: Arbeitsmodi und Scrum Guide', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Planning' }).click();
  await expect(page.getByText('Planning focus')).toBeVisible();
  await expect(page.getByText('Sprint goal draft')).toBeVisible();
  await expect(page.getByText('Definition of Ready / Done')).toBeVisible();
  await expect(page.locator('.workflow-sidebar').getByRole('button', { name: 'Definition of Ready' })).toBeVisible();
  await expect(page.locator('.workflow-sidebar').getByRole('button', { name: 'Definition of Done' })).toBeVisible();
  await expect(page.getByText('Typical team load', { exact: true })).toBeVisible();

  const goalDraft = page.locator('.workflow-textarea').first();
  await goalDraft.fill('Reduce onboarding support load through stable login flows');
  await page.getByRole('button', { name: 'Save sprint goal' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('button', { name: 'Daily business' }).click();
  await expect(page.getByText('Daily business focus')).toBeVisible();
  await page.getByRole('button', { name: 'Generate AI hints' }).click();
  await expect(page.getByText('Potential plan changes')).toBeVisible();
  await expect(page.getByText('AXON-2: Mobile crash is critical – assign immediately.')).toBeVisible();

  await page.getByRole('button', { name: 'Scrum Guide' }).click();
  await expect(page.getByText('Scrum Guide essentials')).toBeVisible();
  await expect(page.getByText('Commitment')).toBeVisible();
  await expect(page.getByText('What Sprint Planning means')).toBeVisible();
  await page.locator('.scrum-guide-modal .icon-btn').click();
  await expect(page.getByText('Scrum Guide essentials')).toHaveCount(0);

  await page.screenshot({ path: 'e2e/screenshots/12a_modes_and_guide.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 13: Refinement mit lokaler KI
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 13: Refinement mit lokaler KI', async ({ page }) => {
  const captures = {};
  await setupMocks(page, { captures });
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'Refinement' }).click();
  await expect(page.getByText('Refinement focus')).toBeVisible();
  await expect(page.getByText('Modernisierungs Board')).toBeVisible();

  await page.getByRole('button', { name: 'Use local AI' }).first().click();
  await expect(page.getByText('AI refinement')).toBeVisible();
  const refinementEditor = page.locator('.refinement-editor');
  await expect(refinementEditor.locator('input').first()).toHaveValue('Implement secure OAuth2 login flow');
  await expect(refinementEditor.locator('.workflow-textarea--lg')).toHaveValue(/Provide OAuth2 login/);
  await expect(refinementEditor.locator('.workflow-textarea').nth(1)).toHaveValue(/OAuth2 login succeeds for valid users\./);
  await expect(page.getByText('Do we need migration support for existing sessions?')).toBeVisible();
  expect(captures.refineTicket.model).toBe('qwen3:14b');

  await page.getByRole('button', { name: 'Apply to Jira' }).click();
  await expect(page.getByText('Refinement applied to Jira.')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/13a_refinement_ai.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 10: Persistierte Board-Ansicht wird geladen
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 10: Persistierte Board-Ansicht laden', async ({ page }) => {
  await setupMocks(page, {
    boardState: {
      showArchive: false,
      placements: {
        'AXON-2': 'sprint:11',
        'AXON-4': 'backlog',
      },
      checklists: {
        'AXON-2': {
          ready: {
            titleDescription: false,
            acceptance: true,
            objective: true,
            component: false,
            estimate: false,
            dependencies: false,
          },
          done: {
            tests: true,
            docs: false,
            openPoints: false,
            acceptanceVerified: false,
            merged: false,
          },
        },
      },
    },
  });
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  const sprintBacklog = page.locator('.sprint-section').first();
  await expect(page.locator('.sprint-section-title').filter({ hasText: /^Archive$/ })).toHaveCount(0);
  await expect(sprintBacklog.getByText('Fix dashboard crash on mobile')).toBeVisible();
  await expect(page.locator('.ticket-table-row', { hasText: 'Improve search performance' })).toHaveCount(0);
  await expect(sprintBacklog.getByText('2/6')).toBeVisible();
  await expect(sprintBacklog.getByText('1/5')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/10a_persisted_board.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 11: Drag and Drop wird über Reload persistiert
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 11: Drag and Drop Persistenz', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  const ticketRow = page.locator('.ticket-table-row', { hasText: 'Fix dashboard crash on mobile' });
  const futureSprint = page.locator('.sprint-section').filter({ hasText: 'Sprint 25' });
  await expect(ticketRow).toBeVisible();
  await expect(futureSprint).toBeVisible();

  await page.evaluate(() => {
    const source = Array.from(document.querySelectorAll('.ticket-table-row'))
      .find((element) => element.textContent?.includes('Fix dashboard crash on mobile'));
    const target = Array.from(document.querySelectorAll('.sprint-section'))
      .find((element) => element.textContent?.includes('Sprint 25'));
    if (!source || !target) throw new Error('Drag source or target not found');

    const dataTransfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
  });
  await page.waitForTimeout(400);
  await expect(futureSprint.getByText('Fix dashboard crash on mobile')).toBeVisible();

  await page.reload();
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  const futureSprintAfterReload = page.locator('.sprint-section').filter({ hasText: 'Sprint 25' });
  await expect(futureSprintAfterReload.getByText('Fix dashboard crash on mobile')).toBeVisible();

  await page.screenshot({ path: 'e2e/screenshots/11a_dragdrop_persisted.png', fullPage: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 14: Middle-Mouse-Panning scrollt den aktiven Bereich
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 14: Middle-Mouse-Panning scrollt Widget-Inhalte', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await setupMocks(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scrum Guide' }).click();
  await expect(page.locator('.scrum-guide-modal')).toBeVisible();

  const scrollArea = page.locator('.scrum-guide-modal .ticket-modal-body');
  await expect(scrollArea).toBeVisible();

  const after = await scrollArea.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const startY = rect.top + Math.min(rect.height - 20, 220);
    const moveY = rect.top + 80;
    const before = element.scrollTop;

    element.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 1,
      buttons: 4,
      clientX: centerX,
      clientY: startY,
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      button: 1,
      buttons: 4,
      clientX: centerX,
      clientY: moveY,
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      cancelable: true,
      button: 1,
      buttons: 0,
      clientX: centerX,
      clientY: moveY,
    }));

    return { before, after: element.scrollTop };
  });

  expect(after.after).toBeGreaterThan(after.before);
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 15: Tabellenspalten sortieren und verschieben persistiert
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 15: Tabellen-Spalten sortierbar und verschiebbar', async ({ page }) => {
  await setupMocks(page, {
    boardState: {
      placements: {
        'AXON-1': 'backlog',
        'AXON-2': 'backlog',
        'AXON-3': 'backlog',
      },
    },
  });

  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  const backlog = page.locator('.sprint-section').filter({
    has: page.locator('.sprint-section-title', { hasText: /^Backlog$/ }),
  });
  await expect(backlog).toBeVisible();

  const pointsHeader = backlog.locator('.ticket-table-header-btn').filter({ hasText: /^Points/ }).first();
  await pointsHeader.click();
  await pointsHeader.click();

  await expect(backlog.locator('.ticket-table-row').first().locator('.ticket-key')).toHaveText('AXON-3');

  await page.evaluate(() => {
    const backlogSection = Array.from(document.querySelectorAll('.sprint-section'))
      .find((element) => {
        const title = element.querySelector('.sprint-section-title');
        return title?.textContent?.trim() === 'Backlog';
      });
    if (!backlogSection) throw new Error('Backlog section not found');
    const headers = backlogSection.querySelectorAll('.ticket-table-header-btn');
    const points = Array.from(headers).find((element) => element.textContent?.trim().startsWith('Points'));
    const ticket = Array.from(headers).find((element) => element.textContent?.trim().startsWith('Ticket'));
    if (!points || !ticket) throw new Error('Points or Ticket header not found');
    const dataTransfer = new DataTransfer();
    points.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
    ticket.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
    ticket.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  });

  await page.waitForTimeout(200);
  await expect(backlog.locator('.ticket-table-header-btn').first()).toContainText('Points');

  await page.reload();
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  const backlogAfterReload = page.locator('.sprint-section').filter({
    has: page.locator('.sprint-section-title', { hasText: /^Backlog$/ }),
  });
  await expect(backlogAfterReload.locator('.ticket-table-header-btn').first()).toContainText('Points');
  await expect(backlogAfterReload.locator('.ticket-table-row').first().locator('.ticket-key')).toHaveText('AXON-3');
});

// ─────────────────────────────────────────────────────────────────────────────
// Szenario 16: Rechte DoR/DoD-Seitenleiste ist einklappbar und pro Ticket nutzbar
// ─────────────────────────────────────────────────────────────────────────────
test('Szenario 16: DoR/DoD Sidebar ist ausklappbar und pro Ticket abhakbar', async ({ page }) => {
  const captures = {};
  await setupMocks(page, { captures });
  await page.goto('/');
  await projectSelect(page).selectOption('AXON');
  await page.waitForTimeout(400);

  const sidebar = page.locator('.workflow-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('Definition of Ready / Done')).toBeVisible();
  await expect(sidebar.getByText('Clear title and understandable description are present.')).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'Definition of Ready' }).click();
  await expect(sidebar.getByText('Clear title and understandable description are present.')).toBeVisible();

  await sidebar.locator('select.input').selectOption('AXON-2');
  const componentCheckbox = sidebar.getByLabel('Product/component is assigned.');
  await componentCheckbox.check();

  await expect.poll(() => captures.boardState?.checklists?.['AXON-2']?.ready?.component).toBe(true);
  await page.screenshot({ path: 'e2e/screenshots/16a_dod_sidebar.png', fullPage: true });
});
