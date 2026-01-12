describe('Reports and Admin Tasks', () => {
  it('should display Analytics and Reports', () => {
    cy.visit('/reports');
    cy.contains('Income vs Expense Analysis').should('be.visible');
    cy.get('.stats-grid').should('be.visible');
  });

  it('should display Activity Logs', () => {
    cy.visit('/logs');
    cy.contains('Activity Logs').should('be.visible');
    cy.get('.logs-table').should('be.visible');
  });

  it('should load User Management', () => {
    cy.visit('/users');
    cy.contains('User Access Control').should('be.visible');
    cy.get('.user-card').should('have.length.at.least', 1);
  });

  it('should load Store Configuration', () => {
    cy.visit('/stores');
    cy.contains('Store Configuration').should('be.visible');
  });

  it('should load Ad Inventory', () => {
    cy.visit('/ads');
    cy.contains('Ad Inventory').should('be.visible');
    cy.get('.stats-grid').should('be.visible');
  });
});
