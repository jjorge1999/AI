describe('POS and Sales Management', () => {
  it('should load POS Calculator', () => {
    cy.visit('/sell');
    cy.get('.pos-container', { timeout: 15000 }).should('be.visible');
    cy.contains('All Items').should('be.visible');
  });

  it('should load Sales Management page and show stats', () => {
    cy.visit('/sales');
    cy.contains('Sales & Promotions').should('be.visible');
    cy.get('.stats-grid', { timeout: 10000 }).should('be.visible');
    cy.contains('Active Campaigns').should('be.visible');
  });

  it('should open New Campaign modal', () => {
    cy.visit('/sales');
    cy.contains('New Campaign').click();
    cy.get('.modal-content').should('be.visible');
    cy.contains('Add Promotion Card').should('be.visible');
  });
});
