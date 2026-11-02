import { boundingBox } from "../domain/geo.js";
import { prisma, type TxClient } from "../lib/prisma.js";

export type Candidate = {
  workerProfileId: string;
  userId: string;
  distanceKm: number;
  bayesianScore: number | null;
  jobsCompleted: number;
  cancellations: number;
  avgResponseMinutes: number | null;
};

/**
 * Verified, available, active workers in `categoryId` whose distance to the point is within
 * LEAST(radiusKm, worker.service_radius_km). Bounding-box prefilter uses the (base_lat, base_lng)
 * index; the haversine expression is exact (ADR 002, system-design.md §7.1).
 */
export const matchingRepository = {
  async findCandidates(
    params: {
      lat: number;
      lng: number;
      radiusKm: number;
      categoryId: string;
      excludeRequestId?: string;
    },
    tx: TxClient = prisma,
  ): Promise<Candidate[]> {
    const { lat, lng, radiusKm, categoryId } = params;
    const box = boundingBox({ lat, lng }, radiusKm);
    const excludeId = params.excludeRequestId ?? null;
    return tx.$queryRaw<Candidate[]>`
      SELECT * FROM (
        SELECT wp.id AS "workerProfileId",
               wp.user_id AS "userId",
               (6371 * 2 * asin(least(1, sqrt(
                 power(sin(radians(wp.base_lat - ${lat}) / 2), 2) +
                 cos(radians(${lat})) * cos(radians(wp.base_lat)) *
                 power(sin(radians(wp.base_lng - ${lng}) / 2), 2)
               ))))::float8 AS "distanceKm",
               wp.service_radius_km AS "serviceRadiusKm",
               ws.bayesian_score AS "bayesianScore",
               COALESCE(ws.jobs_completed, 0)::int AS "jobsCompleted",
               COALESCE(ws.cancellations, 0)::int AS "cancellations",
               ws.avg_response_minutes AS "avgResponseMinutes"
        FROM worker_profile wp
        JOIN worker_category wc ON wc.worker_profile_id = wp.id AND wc.category_id = ${categoryId}::uuid
        JOIN "user" u ON u.id = wp.user_id AND u.status = 'ACTIVE'
        LEFT JOIN worker_stats ws ON ws.worker_profile_id = wp.id AND ws.category_id = ${categoryId}::uuid
        WHERE wp.verification_status = 'VERIFIED'
          AND wp.is_available = true
          AND wp.base_lat BETWEEN ${box.minLat} AND ${box.maxLat}
          AND wp.base_lng BETWEEN ${box.minLng} AND ${box.maxLng}
          AND NOT EXISTS (
            SELECT 1 FROM request_match rm
            WHERE rm.request_id = ${excludeId}::uuid AND rm.worker_profile_id = wp.id
          )
      ) c
      WHERE c."distanceKm" <= LEAST(${radiusKm}::float8, c."serviceRadiusKm")
      ORDER BY c."distanceKm" ASC`;
  },
};
