describe('Public Accessible Routes', () => {
  it('should load Reservation page', () => {
    cy.visit('/reservation');
    cy.contains('Reservation').should('be.visible');
  });

  it('should load Color Game (Play)', () => {
    cy.visit('/play');
    cy.get('.color-game-container', { timeout: 15000 }).should('be.visible');
  });

  it('should redirect from home to login if not logged in', () => {
    cy.clearLocalStorage();
    cy.visit('/home');
    cy.url().should('include', '/login');
    cy.get('.login-container').should('be.visible');
  });
});
