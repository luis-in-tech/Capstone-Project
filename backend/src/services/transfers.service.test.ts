import * as transfersService from './transfers.service';

describe('Transfers Service', () => {
  it('should reject transfers where source and destination are the same', async () => {
    await expect(
      transfersService.initiateTransfers({
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-1',
        items: [{ productId: 'prod-1', quantity: 5 }],
        initiatedBy: 'tester',
      })
    ).rejects.toThrow('Source and destination warehouses must be different');
  });

  it('should reject transfers with zero or negative quantity', async () => {
    await expect(
      transfersService.initiateTransfers({
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        items: [{ productId: 'prod-1', quantity: 0 }],
        initiatedBy: 'tester',
      })
    ).rejects.toThrow('Quantity for product prod-1 must be greater than zero');
  });

  it('should successfully initiate, dispatch, and receive a transfer', async () => {
    const initiated = await transfersService.initiateTransfers({
      sourceWarehouseId: 'wh-valenzuela',
      destinationWarehouseId: 'wh-cavite',
      items: [{ productId: 'prod-shimano', quantity: 15 }],
      initiatedBy: 'tester',
    });

    expect(initiated.length).toBe(1);
    const transfer = initiated[0];
    expect(transfer.status).toBe('pending');

    // Dispatch
    const dispatched = await transfersService.dispatchTransfer(transfer.id, {
      driverName: 'Cardo Dalisay',
      vehiclePlate: 'ABC-1234',
      dispatchedBy: 'dispatcher-1',
    });
    expect(dispatched.status).toBe('in_transit');
    expect(dispatched.driverName).toBe('Cardo Dalisay');

    // Receive
    const received = await transfersService.receiveTransfer(transfer.id, {
      receivedBy: 'receiver-1',
    });
    expect(received.status).toBe('received');
    expect(received.receivedBy).toBe('receiver-1');
  });

  it('should allow cancellation while pending or in_transit and record audit', async () => {
    const [tfr] = await transfersService.initiateTransfers({
      sourceWarehouseId: 'wh-a',
      destinationWarehouseId: 'wh-b',
      items: [{ productId: 'prod-test', quantity: 5 }],
      initiatedBy: 'tester',
    });

    await transfersService.dispatchTransfer(tfr.id, {
      driverName: 'Driver 1',
      vehiclePlate: 'XYZ-999',
      dispatchedBy: 'disp',
    });

    const cancelled = await transfersService.cancelTransfer(tfr.id, {
      cancellationReason: 'Road closure emergency',
      cancelledBy: 'supervisor',
    });

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancellationReason).toBe('Road closure emergency');

    const auditLogs = await transfersService.getTransferAuditLogs(tfr.id);
    expect(auditLogs.length).toBeGreaterThanOrEqual(2);
  });
});
