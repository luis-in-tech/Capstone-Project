/**
 * @file logistics.controller.ts
 * @description Express controller handlers for the Logistics Optimizer API.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import * as logisticsService from '../services/logistics.service';
import { ApiSuccess } from '../types/api.types';
import {
  OrderStopItem,
  LocationCoord,
  VehicleSpec,
  DispatchTripPayload,
  CreateTrafficIncidentPayload,
  StockRebalancePayload,
} from '../types/logistics.types';

function ok<T>(res: Response, data: T, message?: string, status = 200): void {
  const body: ApiSuccess<T> = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

const optimizeRoutesSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string().optional(),
      orderNumber: z.string().optional(),
      clientName: z.string().optional(),
      deliveryCity: z.string().optional(),
      deliveryRegion: z.string().optional(),
      status: z.string().optional(),
      skus: z.array(z.string()).optional(),
      totalAmount: z.number().finite().nonnegative().optional(),
    })
  ),
  depot: z
    .object({
      name: z.string().trim().min(1),
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
    })
    .optional(),
  fleet: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        capacity: z.number().finite().positive(),
        fixedCost: z.number().finite().nonnegative(),
        costPerKm: z.number().finite().nonnegative(),
      })
    )
    .min(1)
    .optional(),
});

const dispatchTripSchema = z.object({
  vehicleId: z.string().trim().optional(),
  vehicleName: z.string().trim().min(1),
  plate: z.string().trim().min(1),
  driver: z.string().trim().min(1),
  region: z.string().trim().min(1).default('Metro Manila'),
  routeId: z.string().trim().min(1).default('manual-route'),
  totalUnits: z.number().finite().nonnegative().optional(),
  savingsPhp: z.number().finite().nonnegative().optional(),
  stops: z.array(
    z.object({
      orderId: z.string().optional(),
      orderNumber: z.string().optional(),
      clientName: z.string().optional(),
      deliveryCity: z.string().trim().min(1),
      units: z.number().finite().positive(),
      stopSequence: z.number().int().positive(),
    })
  ),
  dispatchedBy: z.string().trim().min(1).default('dispatcher'),
});

export async function optimizeRoutes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = optimizeRoutesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid route optimization payload.' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { orders, depot, fleet } = parsed.data;
    const result = logisticsService.optimizeRoutes(
      orders as OrderStopItem[],
      depot as LocationCoord | undefined,
      fleet as VehicleSpec[] | undefined
    );
    ok(res, result, 'Logistics routes optimized successfully.');
  } catch (err) {
    next(err);
  }
}

export async function dispatchTrip(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = dispatchTripSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid dispatch trip payload.');
    }
    const trip = await logisticsService.createDispatchTrip(parsed.data as DispatchTripPayload);
    ok(res, trip, `Dispatch trip created for vehicle "${trip.vehicleName}" (${trip.plate}).`, 201);
  } catch (err) {
    next(err);
  }
}

export async function listDispatchTrips(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const trips = await logisticsService.listDispatchTrips();
    ok(res, trips, `${trips.length} dispatch trip(s) found.`);
  } catch (err) {
    next(err);
  }
}

const incidentPayloadSchema = z.object({
  type: z.enum(['accident', 'closure', 'congestion']),
  corridor: z.string().trim().min(1),
  delayMinutes: z.number().finite().positive(),
  reporter: z.string().trim().min(1),
  bypassRoute: z.string().trim().optional(),
  timeSavedMinutes: z.number().finite().nonnegative().optional(),
});

export async function reportIncident(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = incidentPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid traffic incident payload.');
    }
    const payload = parsed.data as CreateTrafficIncidentPayload;
    const incident = await logisticsService.createTrafficIncident(payload);
    ok(res, incident, 'Traffic incident reported and detour computed.', 201);
  } catch (err) {
    next(err);
  }
}

export async function listIncidents(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const incidents = await logisticsService.listTrafficIncidents();
    ok(res, incidents, `${incidents.length} traffic incident(s) retrieved.`);
  } catch (err) {
    next(err);
  }
}

const rebalancePayloadSchema = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().optional(),
  surplusWarehouseId: z.string().trim().min(1),
  surplusWarehouseName: z.string().trim().optional(),
  depletedWarehouseId: z.string().trim().min(1),
  depletedWarehouseName: z.string().trim().optional(),
  recommendedTransferQty: z.number().int().positive(),
  initiatedBy: z.string().trim().min(1).optional(),
});

export async function rerouteIncident(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawId = req.params['id'];
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Incident ID is required.');
    }
    const updated = await logisticsService.rerouteTrafficIncident(id);
    ok(res, updated, `Incident "${id}" marked rerouted.`);
  } catch (err) {
    next(err);
  }
}

export async function triggerRebalance(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = rebalancePayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid stock rebalance payload.');
    }
    const result = await logisticsService.triggerRebalance(parsed.data as StockRebalancePayload);
    ok(res, result, result.message, 201);
  } catch (err) {
    next(err);
  }
}
