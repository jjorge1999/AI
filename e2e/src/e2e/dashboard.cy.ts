describe('Dashboard Overview', () => {
  beforeEach(() => {
    cy.visit('/home');
  });

  it('should display the main dashboard greeting and subtitle', () => {
    cy.contains('Dashboard Overview', { timeout: 15000 }).should('be.visible');
    cy.contains('Welcome back').should('be.visible');
  });

  it('should display KPI cards', () => {
    cy.get('.kpi-card', { timeout: 15000 }).should('have.length.at.least', 2);
  });

  it('should have working sidebar navigation links', () => {
    cy.get('.sidebar-nav', { timeout: 15000 }).should('be.visible');
    cy.contains('.nav-label', 'Inventory').should('be.visible');
    cy.contains('.nav-label', 'Point of Sale').should('be.visible');
  });

  it('should open the edit mode and show controls', () => {
    cy.get('.edit-mode-btn', { timeout: 10000 }).click();
    cy.get('.edit-mode-notice').should('be.visible');
    cy.get('.edit-mode-btn').click();
  });
});
