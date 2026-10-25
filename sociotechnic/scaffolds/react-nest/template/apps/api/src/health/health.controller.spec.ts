import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports ok with uptime and an ISO timestamp', () => {
    const health = controller.check();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('api');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
  });
});
