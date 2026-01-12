describe('Inventory & Products Management', () => {
  beforeEach(() => {
    cy.visit('/inventory');
  });

  it('should display the Inventory section with table card', () => {
    cy.contains('Inventory Overview').should('be.visible');
    cy.get('.table-card', { timeout: 15000 }).should('be.visible');
  });

  it('should toggle between table and grid views', () => {
    // Check if grid view button exists and click it
    cy.get('.material-icon').contains('grid_view').parent().click();
    cy.get('.inventory-grid').should('be.visible');

    // Switch back to list view
    cy.get('.material-icon').contains('view_list').parent().click();
    cy.get('.data-table').should('be.visible');
  });

  it('should navigate to Add Product page and show form', () => {
    cy.visit('/add-product');
    cy.contains('Product Information').should('be.visible');
    cy.get('input[placeholder*="Product Name"]').should('be.visible');
  });

  it('should test inventory search functionality', () => {
    cy.get('.page-header .search-input').type('non_existent_product_xyz');
    cy.contains('No available products').should('be.visible');
  });
});
