/**
 * @file logistics.controller.ts
 * @description Express controller handlers for the Logistics Optimizer API.
 */

import { Request, Response, NextFunction } from 'express';
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

export async function optimizeRoutes(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { orders, depot, fleet } = req.body as {
      orders: OrderStopItem[];
      depot?: LocationCoord;
      fleet?: VehicleSpec[];
    };

    if (!Array.isArray(orders)) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '"orders" must be an array.' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const result = logisticsService.optimizeRoutes(orders, depot, fleet);
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
    const payload = req.body as DispatchTripPayload;
    const trip = await logisticsService.createDispatchTrip(payload);
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

export async function reportIncident(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = req.body as CreateTrafficIncidentPayload;
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

export async function rerouteIncident(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const id = req.params['id'] as string;
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
    const payload = req.body as StockRebalancePayload;
    const result = await logisticsService.triggerRebalance(payload);
    ok(res, result, result.message, 201);
  } catch (err) {
    next(err);
  }
}
