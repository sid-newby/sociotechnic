import { Controller, Get } from '@nestjs/common';

export type Health = {
  status: 'ok';
  service: 'api';
  uptime: number;
  timestamp: string;
};

@Controller('health')
export class HealthController {
  @Get()
  check(): Health {
    return {
      status: 'ok',
      service: 'api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
