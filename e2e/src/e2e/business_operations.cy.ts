describe('Business Operations - Customers and Expenses', () => {
  it('should list Customers and open add modal', () => {
    cy.visit('/customers');
    cy.contains('Customer Management').should('be.visible');
    cy.get('.btn-add').should('be.visible').click();
    cy.get('.modal-content').should('be.visible');
    cy.contains('Add New Customer').should('be.visible');
    cy.get('.btn-cancel').click();
  });

  it('should list Expenses and open add modal', () => {
    cy.visit('/expenses');
    cy.contains('Expense Overview').should('be.visible');
    cy.get('.stat-card').should('have.length.at.least', 2);
    cy.get('.btn-add').click();
    cy.get('.modal-content').should('be.visible');
    cy.contains('Add New Expense').should('be.visible');
    cy.get('.btn-cancel').click();
  });
});
