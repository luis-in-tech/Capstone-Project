import * as ordersService from './orders.service';

describe('Orders Service', () => {
  it('should reject order creation if customer name is missing', async () => {
    await expect(
      ordersService.createOrder({
        clientName: '',
        address: '123 Test St, Manila',
        deliveryRegion: 'Metro Manila',
        paymentTerms: 'COD',
        items: [{ productId: 'p1', warehouseId: 'wh1', sku: 'SKU1', name: 'Product 1', quantity: 2, unitPrice: 150 }],
      })
    ).rejects.toThrow('Customer name is required');
  });

  it('should reject order creation if items array is empty', async () => {
    await expect(
      ordersService.createOrder({
        clientName: 'testing',
        address: '123 Test St, Manila',
        deliveryRegion: 'Metro Manila',
        paymentTerms: 'COD',
        items: [],
      })
    ).rejects.toThrow('At least one line item is required');
  });

  it('should create an order for customer "testing" and retrieve it in customer transactions', async () => {
    const created = await ordersService.createOrder({
      clientName: 'testing',
      address: 'Block 4 Lot 2, Valenzuela City',
      deliveryRegion: 'Metro Manila',
      paymentTerms: 'COD',
      discount: 50,
      items: [
        {
          productId: 'prod-shimano-m8100',
          warehouseId: 'wh-valenzuela',
          sku: 'SHI-M8100',
          name: 'Shimano Deore XT M8100',
          quantity: 2,
          unitPrice: 1200,
        },
      ],
      preparedBy: 'Dispatcher QA',
    });

    expect(created.order.id).toBeDefined();
    expect(created.order.clientName).toBe('testing');
    expect(created.order.totalAmount).toBe(2350); // (2 * 1200) - 50
    expect(created.items.length).toBe(1);
    expect(created.items[0].subtotal).toBe(2400);

    // Retrieve transactions under customer "testing"
    const customerTx = await ordersService.getCustomerTransactions('testing');
    expect(customerTx.customer.name).toBe('testing');
    expect(customerTx.customer.key).toBe('customer:testing');
    expect(customerTx.orders.length).toBeGreaterThanOrEqual(1);

    const found = customerTx.orders.find((o) => o.id === created.order.id);
    expect(found).toBeDefined();
    expect(found?.clientName).toBe('testing');
    expect(found?.items?.length).toBe(1);
  });

  it('should list orders and filter by customer name', async () => {
    const list = await ordersService.listOrders({ clientName: 'testing' });
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    expect(list.items.every((o) => o.clientName.toLowerCase().includes('testing'))).toBe(true);
  });
});
